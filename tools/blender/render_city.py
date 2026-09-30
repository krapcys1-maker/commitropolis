"""Render a Commitropolis city with Blender Cycles: posters, hero shots, wallpapers.

Uses the same city bundle and the same visual language as the web viewer (lit windows = recent
work, neon crowns in the district's hue, beams over the latest commits), but path-traced: real
glass reflections, a wet street, atmospheric haze.

  blender -b -P tools/blender/render_city.py -- --data public/data/expressjs-express.json --out docs/img/hero.jpg

Options (after the `--`):
  --at YYYY-MM-DD   the city as it stood that day (default: HEAD, with ruins)
  --shot low|wide   camera preset (default: low)
  --res 1920x1080   output size; use 1080x1920 for vertical
  --samples 192     Cycles samples (denoised)
  --beams 18        light beams over the most recently changed files (0 = none)
  --fog 0.0008      haze density (0 = none)
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone

import bpy

PLATE = 0.18
FLOOR = 1.1
PITCH = 1.0


def height_of(loc):
    return 0.4 + loc**0.55 * 0.6 if loc > 0 else 0.0


def fnv_hash(s):
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 4294967295


def district_hue(path):
    return fnv_hash(path.split('/')[0]) if '/' in path else 0.58


def hsl_to_linear(h, s, l):
    """HSL (sRGB) -> linear RGB, like THREE.Color.setHSL."""
    def hue2rgb(p, q, t):
        t %= 1.0
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * 6 * (2 / 3 - t)
        return p
    q = l * (1 + s) if l <= 0.5 else l + s - l * s
    p = 2 * l - q
    rgb = [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--at')
    ap.add_argument('--shot', default='low', choices=['low', 'wide'])
    ap.add_argument('--res', default='1920x1080')
    ap.add_argument('--samples', type=int, default=192)
    ap.add_argument('--beams', type=int, default=18)
    ap.add_argument('--fog', type=float, default=0.0008)
    return ap.parse_args(argv)


# ---------------------------------------------------------------- city state

def city_state(data, at):
    """Lines, last touch and ruin flag per building, at HEAD or at a given day."""
    files, commits = data['files'], data['commits']
    n = len(files)
    if at is None:
        loc = [f['loc'] for f in files]
        last = [f['last'] for f in files]
        ruin = [not f['alive'] for f in files]
        now = commits[-1]['t']
        history = commits
    else:
        t_at = datetime.strptime(at, '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
        loc, last, ruin = [0.0] * n, [0] * n, [False] * n
        history = [c for c in commits if c['t'] <= t_at]
        for c in history:
            ch = c['c']
            for k in range(0, len(ch), 3):
                i = ch[k]
                loc[i] = max(0.0, loc[i] + ch[k + 1] - ch[k + 2])
                last[i] = c['t']
        now = history[-1]['t'] if history else commits[0]['t']
    half_life = max(45 * 86400, (commits[-1]['t'] - commits[0]['t']) * 0.1)
    max_c = max([f['c'] for f in files if f['alive']] + [1])
    lit = []
    for i, f in enumerate(files):
        if last[i] <= 0 or loc[i] <= 0:
            lit.append(0.0)
            continue
        churn = math.log1p(f['c']) / math.log1p(max_c)
        hot = ((churn - 0.6) / 0.4) ** 1.5 * 0.9 if churn > 0.6 and at is None else 0.0
        lit.append(min(1.0, 0.05 + 0.6 * math.exp(-max(0, now - last[i]) / half_life) + 0.3 * min(hot, 1.0)))
    return loc, last, ruin, lit, history


# ---------------------------------------------------------------- geometry

TIERS = {
    'block': [(1.0, 0.0, 1.0)],
    'tower': [(1.0, 0.0, 0.64), (0.78, 0.64, 0.86), (0.56, 0.86, 1.0)],
}


def build_city_mesh(data, loc, ruin, lit):
    """All buildings in one mesh. Side-face UVs are in world units (u along the face, v up from the
    building's base), so the window grid has the same size on every building."""
    verts, faces, uvs = [], [], []
    face_attr = {'lit': [], 'seed': [], 'top_h': [], 'ruin': [], 'face_id': [], 'hue': []}

    def quad(corners, uv, attrs, fid):
        base = len(verts)
        verts.extend(corners)
        faces.append((base, base + 1, base + 2, base + 3))
        uvs.extend(uv)
        for key, val in attrs.items():
            face_attr[key].append(val)
        face_attr['face_id'].append(fid)

    for i, f in enumerate(data['files']):
        h = height_of(loc[i])
        is_ruin = h == 0 and ruin[i]
        if is_ruin:
            h = 0.08
        if h <= 0:
            continue
        peak_h = height_of(f['peak'])
        kind = 'tower' if peak_h >= 14 and peak_h / max(f['w'], f['d']) >= 1.7 and not is_ruin else 'block'
        base = (len(f['p'].split('/')) - 1) * PLATE
        cx, cy = f['x'] + f['w'] / 2, -(f['z'] + f['d'] / 2)
        top = district_hue(f['p'])
        hue = hsl_to_linear(top, 0.95 if '/' in f['p'] else 0.35, 0.5) + [1.0]
        attrs = {'lit': lit[i], 'seed': fnv_hash(f['p']), 'top_h': h, 'ruin': 1.0 if is_ruin else 0.0, 'hue': hue}
        for frac, y0, y1 in TIERS[kind]:
            hw, hd = f['w'] / 2 * frac, f['d'] / 2 * frac
            xm, xp, ym, yp = cx - hw, cx + hw, cy - hd, cy + hd
            z0, z1 = base + y0 * h, base + y1 * h
            v0, v1 = y0 * h, y1 * h
            quad([(xp, ym, z0), (xp, yp, z0), (xp, yp, z1), (xp, ym, z1)], [(ym, v0), (yp, v0), (yp, v1), (ym, v1)], attrs, 0)
            quad([(xm, yp, z0), (xm, ym, z0), (xm, ym, z1), (xm, yp, z1)], [(-yp, v0), (-ym, v0), (-ym, v1), (-yp, v1)], attrs, 1)
            quad([(xp, yp, z0), (xm, yp, z0), (xm, yp, z1), (xp, yp, z1)], [(-xp, v0), (-xm, v0), (-xm, v1), (-xp, v1)], attrs, 2)
            quad([(xm, ym, z0), (xp, ym, z0), (xp, ym, z1), (xm, ym, z1)], [(xm, v0), (xp, v0), (xp, v1), (xm, v1)], attrs, 3)
            quad([(xm, ym, z1), (xp, ym, z1), (xp, yp, z1), (xm, yp, z1)], [(xm, ym), (xp, ym), (xp, yp), (xm, yp)], attrs, 4)

    mesh = bpy.data.meshes.new('Buildings')
    mesh.from_pydata(verts, [], faces)
    uv_layer = mesh.uv_layers.new(name='UVMap')
    uv_layer.data.foreach_set('uv', [c for uv in uvs for c in uv])
    for key in ('lit', 'seed', 'top_h', 'ruin', 'face_id'):
        mesh.attributes.new(key, 'FLOAT', 'FACE').data.foreach_set('value', face_attr[key])
    mesh.attributes.new('hue', 'FLOAT_COLOR', 'FACE').data.foreach_set('color', [c for col in face_attr['hue'] for c in col])
    mesh.update()
    return mesh


def build_plates(data):
    """District plates (boxes) plus a flat neon frame on top of each, in the district's hue."""
    verts, faces, frame_v, frame_f, frame_hue, frame_level = [], [], [], [], [], []
    for d in data['districts']:
        x0, x1 = d['x'], d['x'] + d['w']
        y0, y1 = -(d['z'] + d['d']), -d['z']
        z0, z1 = (d['depth'] - 1) * PLATE, d['depth'] * PLATE
        b = len(verts)
        verts += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        faces += [(b + 4, b + 5, b + 6, b + 7), (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]
        t = 0.12
        z = z1 + 0.004
        hue = hsl_to_linear(district_hue(d['p']), 0.95, 0.5) + [1.0]
        for rect in [(x0, y0, x1, y0 + t), (x0, y1 - t, x1, y1), (x0, y0 + t, x0 + t, y1 - t), (x1 - t, y0 + t, x1, y1 - t)]:
            fb = len(frame_v)
            frame_v += [(rect[0], rect[1], z), (rect[2], rect[1], z), (rect[2], rect[3], z), (rect[0], rect[3], z)]
            frame_f.append((fb, fb + 1, fb + 2, fb + 3))
            frame_hue.append(hue)
            frame_level.append(1.0 / d['depth'])
    plates = bpy.data.meshes.new('Plates')
    plates.from_pydata(verts, [], faces)
    frames = bpy.data.meshes.new('Frames')
    frames.from_pydata(frame_v, [], frame_f)
    frames.attributes.new('hue', 'FLOAT_COLOR', 'FACE').data.foreach_set('color', [c for col in frame_hue for c in col])
    frames.attributes.new('level', 'FLOAT', 'FACE').data.foreach_set('value', frame_level)
    return plates, frames


# ---------------------------------------------------------------- shader helpers

class Nodes:
    """Tiny helper to write shader math as expressions instead of hundreds of node calls."""

    def __init__(self, tree):
        self.tree = tree
        self.n = tree.nodes
        for node in list(self.n):
            self.n.remove(node)

    def link(self, value, socket):
        if isinstance(value, (int, float)):
            socket.default_value = value
        elif isinstance(value, (tuple, list)):
            socket.default_value = value
        else:
            self.tree.links.new(value, socket)

    def math(self, op, a, b=None, c=None, clamp=False):
        node = self.n.new('ShaderNodeMath')
        node.operation = op
        node.use_clamp = clamp
        for socket, value in zip(node.inputs, (a, b, c)):
            if value is not None:
                self.link(value, socket)
        return node.outputs[0]

    def add(self, a, b):
        return self.math('ADD', a, b)

    def sub(self, a, b):
        return self.math('SUBTRACT', a, b)

    def mul(self, a, b):
        return self.math('MULTIPLY', a, b)

    def gt(self, a, b):
        return self.math('GREATER_THAN', a, b)

    def lt(self, a, b):
        return self.math('LESS_THAN', a, b)

    def attr(self, name):
        node = self.n.new('ShaderNodeAttribute')
        node.attribute_name = name
        return node

    def xyz(self, x, y, z):
        node = self.n.new('ShaderNodeCombineXYZ')
        for sock, v in zip(node.inputs, (x, y, z)):
            self.link(v, sock)
        return node.outputs[0]

    def split(self, vec):
        node = self.n.new('ShaderNodeSeparateXYZ')
        self.link(vec, node.inputs[0])
        return node.outputs

    def noise(self, vec):
        node = self.n.new('ShaderNodeTexWhiteNoise')
        node.noise_dimensions = '3D'
        self.link(vec, node.inputs['Vector'])
        return node.outputs['Value']

    def mix(self, fac, a, b):
        node = self.n.new('ShaderNodeMix')
        node.data_type = 'RGBA'
        self.link(fac, node.inputs['Factor'])
        ins = [s for s in node.inputs if s.type == 'RGBA']
        self.link(a, ins[0])
        self.link(b, ins[1])
        return [s for s in node.outputs if s.type == 'RGBA'][0]

    def scale(self, vec, s):
        node = self.n.new('ShaderNodeVectorMath')
        node.operation = 'SCALE'
        self.link(vec, node.inputs[0])
        self.link(s, node.inputs['Scale'])
        return node.outputs[0]

    def vadd(self, a, b):
        node = self.n.new('ShaderNodeVectorMath')
        node.operation = 'ADD'
        self.link(a, node.inputs[0])
        self.link(b, node.inputs[1])
        return node.outputs[0]

    def output(self, shader):
        out = self.n.new('ShaderNodeOutputMaterial')
        self.link(shader, out.inputs['Surface'])
        return out


def new_material(name):
    mat = bpy.data.materials.new(name)
    if not getattr(mat, 'use_nodes', True):
        mat.use_nodes = True
    return mat


def principled_material(name, color, roughness=0.5, metallic=0.0):
    mat = new_material(name)
    g = Nodes(mat.node_tree)
    bsdf = g.n.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    g.output(bsdf.outputs[0])
    return mat


def building_material():
    mat = new_material('Building')
    g = Nodes(mat.node_tree)
    uv = g.split(g.n.new('ShaderNodeUVMap').outputs['UV'])
    u, v = uv[0], uv[1]
    nz = g.split(g.n.new('ShaderNodeNewGeometry').outputs['Normal'])[2]
    lit_a, seed, top_h, ruin, face = (g.attr(k).outputs['Fac'] for k in ('lit', 'seed', 'top_h', 'ruin', 'face_id'))
    hue = g.attr('hue').outputs['Color']

    roof = g.gt(nz, 0.5)
    gx, gy = g.math('DIVIDE', u, PITCH), g.math('DIVIDE', v, FLOOR)
    cx, cy = g.math('FLOOR', gx), g.math('FLOOR', gy)
    fx, fy = g.math('FRACT', gx), g.math('FRACT', gy)
    win = g.mul(g.mul(g.gt(fx, 0.2), g.lt(fx, 0.8)), g.mul(g.gt(fy, 0.3), g.lt(fy, 0.84)))
    top_gap = g.sub(top_h, v)
    facade = g.mul(g.mul(g.sub(1, roof), g.gt(top_gap, 0.7)), g.mul(g.gt(v, 0.45), g.sub(1, ruin)))
    win = g.mul(win, facade)
    rand = g.noise(g.xyz(cx, cy, g.add(g.mul(seed, 917), g.mul(face, 13))))
    lit = g.mul(win, g.lt(rand, lit_a))
    warm = g.noise(g.xyz(g.mul(cx, 7), g.mul(cy, 3), g.mul(seed, 311)))
    glass = g.mul(win, g.sub(1, lit))

    lamp = g.mix(g.gt(warm, 0.78), (1.0, 0.62, 0.3, 1), (0.6, 0.78, 1.0, 1))
    window_glow = g.scale(lamp, g.mul(lit, g.add(1.1, g.mul(warm, 1.7))))
    crown = g.mul(g.mul(g.sub(1, roof), g.lt(top_gap, 0.45)), g.sub(1, ruin))
    neon = g.scale(hue, g.mul(crown, g.add(2.5, g.mul(lit_a, 8.0))))
    emission = g.vadd(window_glow, neon)

    wall = g.vadd(g.scale(hue, 0.06), (0.014, 0.016, 0.022))
    color = g.mix(win, wall, (0.01, 0.012, 0.018, 1))
    color = g.mix(roof, color, (0.025, 0.026, 0.03, 1))
    color = g.mix(ruin, color, (0.04, 0.04, 0.045, 1))

    bsdf = g.n.new('ShaderNodeBsdfPrincipled')
    g.link(color, bsdf.inputs['Base Color'])
    g.link(glass, bsdf.inputs['Metallic'])
    g.link(g.math('MULTIPLY_ADD', glass, -0.68, 0.72), bsdf.inputs['Roughness'])
    g.link(emission, bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 1.0
    g.output(bsdf.outputs[0])
    return mat


def plate_material():
    return principled_material('Plate', (0.016, 0.017, 0.024, 1), roughness=0.55)


def frame_material():
    mat = new_material('Frame')
    g = Nodes(mat.node_tree)
    em = g.n.new('ShaderNodeEmission')
    g.link(g.attr('hue').outputs['Color'], em.inputs['Color'])
    g.link(g.add(0.6, g.mul(g.attr('level').outputs['Fac'], 5.0)), em.inputs['Strength'])
    g.output(em.outputs[0])
    return mat


def ground_material():
    """Wet asphalt: dark, with puddles of low roughness that mirror the neon."""
    mat = new_material('Ground')
    g = Nodes(mat.node_tree)
    noise = g.n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.035
    noise.inputs['Detail'].default_value = 6.0
    tc = g.n.new('ShaderNodeTexCoord')
    g.link(tc.outputs['Object'], noise.inputs['Vector'])
    puddle = g.math('MULTIPLY', g.sub(noise.outputs['Fac'], 0.47), 12.0, clamp=True)
    bsdf = g.n.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Base Color'].default_value = (0.006, 0.0065, 0.009, 1)
    g.link(g.math('MULTIPLY_ADD', puddle, -0.5, 0.55), bsdf.inputs['Roughness'])
    g.output(bsdf.outputs[0])
    return mat


def beam_material():
    """Light column: bright at the roof, fading out upward."""
    mat = new_material('Beam')
    g = Nodes(mat.node_tree)
    z = g.split(g.n.new('ShaderNodeTexCoord').outputs['Generated'])[2]
    fade = g.math('POWER', g.sub(1.0, z), 3.0, clamp=True)
    em = g.n.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1.0, 0.55, 0.22, 1)
    g.link(g.mul(fade, 5.0), em.inputs['Strength'])
    tr = g.n.new('ShaderNodeBsdfTransparent')
    add = g.n.new('ShaderNodeAddShader')
    g.link(tr.outputs[0], add.inputs[0])
    g.link(em.outputs[0], add.inputs[1])
    g.output(add.outputs[0])
    return mat


def emission_material(name, color, strength):
    mat = new_material(name)
    g = Nodes(mat.node_tree)
    em = g.n.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = color
    em.inputs['Strength'].default_value = strength
    g.output(em.outputs[0])
    return mat


def night_world():
    world = bpy.data.worlds.new('Night')
    if not getattr(world, 'use_nodes', True):
        world.use_nodes = True
    g = Nodes(world.node_tree)
    direction = g.n.new('ShaderNodeTexCoord').outputs['Generated']
    z = g.split(direction)[2]
    ramp = g.n.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.0, (0.1, 0.03, 0.14, 1)
    els[1].position, els[1].color = 0.5, (0.0008, 0.001, 0.003, 1)
    mid = els.new(0.12)
    mid.color = (0.012, 0.012, 0.03, 1)
    g.link(g.math('MAXIMUM', z, 0.0), ramp.inputs['Fac'])
    vor = g.n.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 420.0
    g.link(direction, vor.inputs['Vector'])
    stars = g.mul(g.lt(vor.outputs['Distance'], 0.035), g.gt(z, 0.06))
    sky = g.vadd(ramp.outputs['Color'], g.scale((0.7, 0.75, 0.9), stars))
    bg = g.n.new('ShaderNodeBackground')
    g.link(sky, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    out = g.n.new('ShaderNodeOutputWorld')
    g.link(bg.outputs[0], out.inputs['Surface'])
    return world


def add_haze(size, density):
    """Haze in a box around the city. A world volume would be infinitely deep and swallow the sky."""
    mat = new_material('Haze')
    g = Nodes(mat.node_tree)
    vol = g.n.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.42, 0.52, 0.95, 1)
    vol.inputs['Density'].default_value = density
    vol.inputs['Anisotropy'].default_value = 0.35
    out = g.n.new('ShaderNodeOutputMaterial')
    g.link(vol.outputs[0], out.inputs['Volume'])
    r, top = size * 2.2, size * 0.45
    mesh = bpy.data.meshes.new('Haze')
    mesh.from_pydata(
        [(-r, -r, -0.5), (r, -r, -0.5), (r, r, -0.5), (-r, r, -0.5), (-r, -r, top), (r, -r, top), (r, r, top), (-r, r, top)],
        [],
        [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)],
    )
    add_object('Haze', mesh, mat)


# ---------------------------------------------------------------- scene

def add_object(name, mesh, material):
    obj = bpy.data.objects.new(name, mesh)
    mesh.materials.append(material)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cylinder(name, x, y, z, radius, height, material, segments=16):
    verts, faces = [], []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        verts += [(x + radius * math.cos(a), y + radius * math.sin(a), z), (x + radius * math.cos(a), y + radius * math.sin(a), z + height)]
    for k in range(segments):
        a0, a1 = 2 * k, 2 * ((k + 1) % segments)
        faces.append((a0, a1, a1 + 1, a0 + 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    return add_object(name, mesh, material)


def add_beams_and_beacons(data, loc, history, count):
    files = data['files']
    base = lambda i: (len(files[i]['p'].split('/')) - 1) * PLATE
    center = lambda i: (files[i]['x'] + files[i]['w'] / 2, -(files[i]['z'] + files[i]['d'] / 2))

    if count:
        beam_mat = beam_material()
        seen = []
        for c in reversed(history):
            ch = c['c']
            for k in range(0, len(ch), 3):
                i = ch[k]
                if i not in seen and loc[i] > 0:
                    seen.append(i)
            if len(seen) >= count:
                break
        for i in seen[:count]:
            f = files[i]
            x, y = center(i)
            cylinder(f'beam {f["p"]}', x, y, base(i) + height_of(loc[i]), min(f['w'], f['d']) * 0.14 + 0.1, 14 + fnv_hash(f['p']) * 18, beam_mat)

    alive = sorted([i for i in range(len(files)) if loc[i] > 0], key=lambda i: -loc[i])
    tall = [i for i in alive[: max(3, round(len(alive) * 0.02))] if height_of(loc[i]) > 12]
    spire_mat = principled_material('Spire', (0.2, 0.22, 0.26, 1), roughness=0.35, metallic=0.9)
    red = emission_material('Aircraft light', (1.0, 0.05, 0.03, 1), 60.0)
    for i in tall:
        x, y = center(i)
        top = base(i) + height_of(loc[i])
        length = 1.5 + height_of(loc[i]) * 0.12
        cylinder(f'spire {i}', x, y, top, 0.1, length, spire_mat, 6)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.22, location=(x, y, top + length))
        bpy.context.active_object.data.materials.append(red)


def setup_camera(data, shot, res):
    s = data['size']
    cam_data = bpy.data.cameras.new('Camera')
    cam = bpy.data.objects.new('Camera', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    target = bpy.data.objects.new('Target', None)
    bpy.context.scene.collection.objects.link(target)
    if shot == 'wide':
        cam.location = (s * 0.62, -s * 0.78, s * 0.42)
        target.location = (0, 0, s * 0.01)
        cam_data.lens = 32
    else:
        cam.location = (s * 0.56, -s * 0.72, s * 0.1)
        target.location = (-s * 0.06, s * 0.05, s * 0.055)
        cam_data.lens = 26
    w, h = res
    if h > w:
        cam_data.lens *= 0.7
    track = cam.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    cam_data.dof.use_dof = True
    cam_data.dof.focus_object = target
    cam_data.dof.aperture_fstop = 5.6
    cam_data.clip_end = s * 20
    bpy.context.scene.camera = cam


def setup_render(scene, args):
    w, h = (int(v) for v in args.res.lower().split('x'))
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    device = 'CPU'
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                device = 'GPU'
                break
        except TypeError:
            continue
    scene.cycles.device = device
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.volume_bounces = 1
    scene.cycles.volume_step_rate = 4.0
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Punchy'
    except TypeError:
        pass
    scene.view_settings.exposure = 0.3
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 92
    scene.render.filepath = os.path.abspath(args.out)  # Blender resolves relative paths its own way
    print(f'Rendering {w}x{h}, {args.samples} samples on {device}')

    # Bloom in the compositor (Blender 5: compositing is a node group on the scene).
    tree = bpy.data.node_groups.new('Glow', 'CompositorNodeTree')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    layers = tree.nodes.new('CompositorNodeRLayers')
    glare = tree.nodes.new('CompositorNodeGlare')
    for value in ('Bloom', 'BLOOM'):
        try:
            glare.inputs['Type'].default_value = value
            break
        except (TypeError, ValueError):
            continue
    glare.inputs['Threshold'].default_value = 1.0
    glare.inputs['Strength'].default_value = 0.55
    glare.inputs['Size'].default_value = 0.6
    out = tree.nodes.new('NodeGroupOutput')
    tree.links.new(layers.outputs['Image'], glare.inputs['Image'])
    tree.links.new(glare.outputs['Image'], out.inputs['Image'])
    scene.compositing_node_group = tree


def main():
    args = parse_args()
    with open(args.data, encoding='utf-8') as fh:
        data = json.load(fh)
    loc, last, ruin, lit, history = city_state(data, args.at)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = night_world()
    if args.fog > 0:
        add_haze(data['size'], args.fog)

    add_object('Buildings', build_city_mesh(data, loc, ruin, lit), building_material())
    plates, frames = build_plates(data)
    add_object('Plates', plates, plate_material())
    add_object('Frames', frames, frame_material())

    s = data['size']
    ground = bpy.data.meshes.new('Ground')
    ground.from_pydata([(-s * 6, -s * 6, -0.02), (s * 6, -s * 6, -0.02), (s * 6, s * 6, -0.02), (-s * 6, s * 6, -0.02)], [], [(0, 1, 2, 3)])
    add_object('Ground', ground, ground_material())

    moon = bpy.data.lights.new('Moon', 'SUN')
    moon.energy = 0.06
    moon.color = (0.66, 0.74, 1.0)
    moon.angle = math.radians(1.5)
    moon_obj = bpy.data.objects.new('Moon', moon)
    moon_obj.rotation_euler = (math.radians(58), 0, math.radians(-35))
    scene.collection.objects.link(moon_obj)

    add_beams_and_beacons(data, loc, history, args.beams)
    setup_camera(data, args.shot, tuple(int(v) for v in args.res.lower().split('x')))
    setup_render(scene, args)
    bpy.ops.render.render(write_still=True)
    print(f'Wrote {args.out}')


main()
