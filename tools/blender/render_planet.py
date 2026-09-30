"""Render a Commitverse world (one GitHub account) from orbit with Blender Cycles.

Same rules as the web planet (src/universe/planet.js): cities are the account's repositories, placed on
land, biggest first; night lights and highways between neighbouring cities; the level of civilisation
(total stars, docs/LORE.md) decides what orbits the world: satellites, a moon, an orbital ring with a
space elevator, stations. Terrain comes from mathutils.noise, so land and cities agree.

  blender -b -P tools/blender/render_planet.py -- --planet public/universe/planets/karpathy.json --out docs/img/planet-karpathy.jpg

Background: NASA SVS Deep Star Maps 2020 (Gaia DR2: ESA/Gaia/DPAC), if .cache/assets/starmap_2020_4k.exr exists.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector, noise

R = 10.0  # planet radius in Blender units
LEVELS = [0, 1, 10, 100, 1000, 10000, 100000, 500000]
# World styles by main language, as in src/universe/lore.js (sea: higher = more ocean).
STYLES = {
    'Python': (['#04142b', '#0f4a6e'], ['#c9b48a', '#2f6a34', '#5b6b3a', '#8a8278'], 0.04),
    'Jupyter Notebook': (['#071528', '#16466a'], ['#d8b98a', '#b8732e', '#8a4a22', '#8a7a6a'], 0.04),
    'JavaScript': (['#0b1a2e', '#1b5a6e'], ['#f0d58a', '#d9aa4e', '#a8723a', '#7e5c40'], -0.1),
    'TypeScript': (['#021030', '#0a3d8a'], ['#e0d4a8', '#3f7a5a', '#56705a', '#8a8a8a'], 0.16),
    'Rust': (['#140905', '#3a2014'], ['#d0773e', '#a8522a', '#7a3a22', '#5a3020'], -0.14),
    'Go': (['#022a2e', '#067a80'], ['#c8eadc', '#3aa08a', '#2a6a60', '#8aa0a0'], 0.06),
    'C': (['#081424', '#34506a'], ['#e6ecf2', '#a6b4c4', '#74849a', '#f4f8fb'], 0.02),
    'C++': (['#140818', '#40163a'], ['#e0aac4', '#a8567a', '#74405e', '#c8c0cc'], 0.02),
    'Cuda': (['#03140c', '#0c4a34'], ['#b8d890', '#2e8a3a', '#1f5a2a', '#6a7a5a'], 0.0),
    'Java': (['#0a1420', '#2a4a5a'], ['#e0b080', '#b87840', '#8a5030', '#6a4a3a'], -0.06),
    'Kotlin': (['#0c0820', '#2a1e5a'], ['#d8c8f0', '#7a5ab8', '#56408a', '#a098b0'], 0.04),
    'Ruby': (['#14060a', '#4a1420'], ['#e8a0a0', '#a8323a', '#7a2230', '#8a7070'], 0.0),
    'Lua': (['#070a24', '#1a2a7a'], ['#c8c0f0', '#5a5ac0', '#40408a', '#9090b0'], 0.06),
    'Shell': (['#061808', '#1a4a24'], ['#d8f0a0', '#7ab83a', '#4a7a2a', '#7a8a6a'], 0.02),
    'Swift': (['#180a06', '#5a2a14'], ['#f8c090', '#e07a3a', '#a84a22', '#8a6a5a'], -0.06),
}
LANG = {
    'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Rust': '#dea584', 'Go': '#00ADD8',
    'C': '#8e9aa8', 'C++': '#f34b7d', 'Jupyter Notebook': '#DA5B0B', 'Java': '#b07219', 'Ruby': '#701516',
    'Cuda': '#3A9E4A', 'Lua': '#4a5fd0', 'Swift': '#F05138', 'Kotlin': '#A97BFF', 'Shell': '#89e051',
}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--planet', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--res', default='1920x1080')
    ap.add_argument('--samples', type=int, default=128)
    ap.add_argument('--subdiv', type=int, default=7)
    return ap.parse_args(argv)


# ---------------------------------------------------------------- deterministic helpers (as in lore.js)

def fnv(s):
    h = 2166136261
    for ch in s.encode('utf-16-le').decode('utf-16-le'):
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 4294967295


def mulberry(seed):
    a = int(seed * 4294967295) & 0xFFFFFFFF

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def hex_rgb(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]


def lerp(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- terrain

class Terrain:
    def __init__(self, login, sea=0.04):
        self.seed = Vector((fnv(login) * 91.7, fnv(login + ':y') * 73.3, fnv(login + ':z') * 57.1))
        self.sea = sea

    def fbm(self, p, octaves):
        return noise.fractal(p, 0.5, 2.03, octaves, noise_basis='PERLIN_NEW')

    def height(self, d):
        p = d * 1.35 + self.seed
        warp = Vector((noise.noise(p + Vector((3.1, 0, 0))), noise.noise(p + Vector((0, 7.7, 0))), noise.noise(p + Vector((0, 0, 11.3)))))
        continents = self.fbm(p + warp * 0.55, 6) * 0.55
        ridges = 1.0 - abs(self.fbm(d * 3.4 + self.seed * 1.7, 5) * 0.6)
        land = continents - self.sea
        return land + max(land, 0.0) * ridges * ridges * 0.55


# ---------------------------------------------------------------- the world

def place_cities(planet, terrain):
    repos = [r for r in planet['repos'] if not r.get('a')][:64]
    max_stars = max([1] + [r['s'] for r in repos])
    placed = []
    for repo in repos:
        rand = mulberry(fnv(f"{planet['login']}/{repo['n']}"))
        size = 0.018 + 0.07 * (math.log10(1 + repo['s']) / math.log10(1 + max_stars))
        best = None
        for attempt in range(400):
            u = rand() * 2 - 1
            lon = rand() * math.pi * 2
            lat = math.asin(u) * 0.82
            d = Vector((math.cos(lat) * math.cos(lon), math.sin(lat), math.cos(lat) * math.sin(lon)))
            if terrain.height(d) < 0.035:
                continue
            if all(c['dir'].angle(d) > (c['size'] + size) * 0.9 for c in placed):
                best = d
                break
            if best is None and attempt > 300:
                best = d
        if best is not None:
            placed.append({'repo': repo, 'dir': best, 'size': size})
    return placed


def roads_between(cities):
    pairs = set()
    for i, c in enumerate(cities):
        near = sorted((c['dir'].angle(o['dir']), j) for j, o in enumerate(cities) if j != i)
        for a, j in near[:2]:
            if a < 0.9:
                pairs.add((min(i, j), max(i, j)))
    return [(cities[i]['dir'], cities[j]['dir']) for i, j in pairs]


def build_planet(planet, terrain, cities, level, subdiv):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    langs = {}
    for r in planet['repos']:
        if r.get('lang'):
            langs[r['lang']] = langs.get(r['lang'], 0) + r['s']
    main = max(langs, key=langs.get) if langs else 'Python'
    ocean_c, land_c, _ = STYLES.get(main, STYLES['Python'])
    pal = {'deep': hex_rgb(ocean_c[0]), 'shallow': hex_rgb(ocean_c[1]), 'sand': hex_rgb(land_c[0]),
           'low': hex_rgb(land_c[1]), 'high': hex_rgb(land_c[2]), 'rock': hex_rgb(land_c[3])}
    snow = hex_rgb('#eef3f7')
    roads = roads_between(cities)

    col_layer = bm.verts.layers.float_color.new('biome')
    light_layer = bm.verts.layers.float.new('lights')
    ocean_layer = bm.verts.layers.float.new('ocean')
    sprawl = 0.9 + level * 0.12
    for v in bm.verts:
        d = v.co.normalized()
        h = terrain.height(d)
        detail = noise.noise(d * 38.0) * 0.5
        if h < 0:
            c = lerp(pal['shallow'], pal['deep'], smooth(0.0, -0.25, h))
            ocean = 1.0
        else:
            c = lerp(pal['sand'], pal['low'], smooth(0.0, 0.035, h))
            c = lerp(c, pal['high'], smooth(0.08, 0.22, h + detail * 0.04))
            c = lerp(c, pal['rock'], smooth(0.22, 0.34, h))
            ocean = 0.0
        ice = min(1.0, smooth(0.78, 0.86, abs(d.y) + detail * 0.05) + (smooth(0.34, 0.42, h) if h > 0 else 0))
        c = lerp(c, snow, ice)
        lights = 0.0
        if not ocean:
            for city in cities:
                ang = d.angle(city['dir'])
                core = math.exp(-((ang / (city['size'] * 0.4)) ** 2))
                metro = math.exp(-((ang / (city['size'] * sprawl)) ** 2))
                lights += core * 2.4 + metro * 0.1
                if core > 0.3:
                    c = lerp(c, [0.1, 0.1, 0.1], core * 0.5)
            for a, b in roads:
                n = a.cross(b).normalized()
                if a.cross(d).dot(n) >= 0 and d.cross(b).dot(n) >= 0:
                    lights = max(lights, math.exp(-((abs(d.dot(n)) / 0.004) ** 2)) * 0.6)
            if level >= 6:
                lights += 0.012
        v[col_layer] = (*c, 1.0)
        v[light_layer] = lights
        v[ocean_layer] = ocean * (1 - ice)
        v.co = d * (R * (1 + max(h, 0.0) * 0.028))

    mesh = bpy.data.meshes.new('World')
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new('World', mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(surface_material())
    return obj, main


# ---------------------------------------------------------------- materials

def nodes_of(mat):
    if not getattr(mat, 'use_nodes', True):
        mat.use_nodes = True
    tree = mat.node_tree
    for n in list(tree.nodes):
        tree.nodes.remove(n)
    return tree


def surface_material():
    mat = bpy.data.materials.new('Surface')
    t = nodes_of(mat)
    n, L = t.nodes, t.links
    biome = n.new('ShaderNodeAttribute'); biome.attribute_name = 'biome'
    lights = n.new('ShaderNodeAttribute'); lights.attribute_name = 'lights'
    ocean = n.new('ShaderNodeAttribute'); ocean.attribute_name = 'ocean'
    rough = n.new('ShaderNodeMapRange')
    L.new(ocean.outputs['Fac'], rough.inputs['Value'])
    rough.inputs['To Min'].default_value = 0.85
    rough.inputs['To Max'].default_value = 0.08
    # street grain so night lights break up like a real city
    grain = n.new('ShaderNodeTexVoronoi'); grain.inputs['Scale'].default_value = 900.0
    grain_mul = n.new('ShaderNodeMath'); grain_mul.operation = 'MULTIPLY_ADD'
    L.new(grain.outputs['Distance'], grain_mul.inputs[0]); grain_mul.inputs[1].default_value = -3.4; grain_mul.inputs[2].default_value = 1.35
    grain_c = n.new('ShaderNodeMath'); grain_c.operation = 'MAXIMUM'; grain_c.inputs[1].default_value = 0.08
    L.new(grain_mul.outputs[0], grain_c.inputs[0])
    strength0 = n.new('ShaderNodeMath'); strength0.operation = 'MULTIPLY'
    L.new(lights.outputs['Fac'], strength0.inputs[0]); L.new(grain_c.outputs[0], strength0.inputs[1])
    strength = n.new('ShaderNodeMath'); strength.operation = 'MULTIPLY'; strength.inputs[1].default_value = 5.0
    L.new(strength0.outputs[0], strength.inputs[0])
    bsdf = n.new('ShaderNodeBsdfPrincipled')
    L.new(biome.outputs['Color'], bsdf.inputs['Base Color'])
    L.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.7, 0.42, 1)
    L.new(strength.outputs[0], bsdf.inputs['Emission Strength'])
    out = n.new('ShaderNodeOutputMaterial')
    L.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat


def cloud_material(seed):
    mat = bpy.data.materials.new('Clouds')
    t = nodes_of(mat)
    n, L = t.nodes, t.links
    tc = n.new('ShaderNodeTexCoord')
    noise_t = n.new('ShaderNodeTexNoise'); noise_t.noise_dimensions = '4D'
    noise_t.inputs['Scale'].default_value = 1.6
    noise_t.inputs['Detail'].default_value = 12.0
    noise_t.inputs['Roughness'].default_value = 0.62
    noise_t.inputs['Distortion'].default_value = 0.35
    noise_t.inputs['W'].default_value = seed
    L.new(tc.outputs['Object'], noise_t.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.52
    ramp.color_ramp.elements[1].position = 0.7
    L.new(noise_t.outputs['Fac'], ramp.inputs['Fac'])
    diffuse = n.new('ShaderNodeBsdfDiffuse'); diffuse.inputs['Color'].default_value = (0.92, 0.93, 0.95, 1)
    transparent = n.new('ShaderNodeBsdfTransparent')
    mix = n.new('ShaderNodeMixShader')
    L.new(ramp.outputs['Color'], mix.inputs['Fac'])
    L.new(transparent.outputs[0], mix.inputs[1]); L.new(diffuse.outputs[0], mix.inputs[2])
    out = n.new('ShaderNodeOutputMaterial')
    L.new(mix.outputs[0], out.inputs['Surface'])
    return mat


def atmosphere_material():
    """Volume shell whose density falls off exponentially with altitude: blue limb, red at the terminator."""
    mat = bpy.data.materials.new('Atmosphere')
    t = nodes_of(mat)
    n, L = t.nodes, t.links
    tc = n.new('ShaderNodeTexCoord')
    length = n.new('ShaderNodeVectorMath'); length.operation = 'LENGTH'
    L.new(tc.outputs['Object'], length.inputs[0])
    alt = n.new('ShaderNodeMath'); alt.operation = 'SUBTRACT'; alt.inputs[1].default_value = R
    L.new(length.outputs['Value'], alt.inputs[0])
    scaled = n.new('ShaderNodeMath'); scaled.operation = 'MULTIPLY'; scaled.inputs[1].default_value = -1.0 / (R * 0.012)
    L.new(alt.outputs[0], scaled.inputs[0])
    dens = n.new('ShaderNodeMath'); dens.operation = 'EXPONENT'
    L.new(scaled.outputs[0], dens.inputs[0])
    k = n.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = 0.9
    L.new(dens.outputs[0], k.inputs[0])
    scatter = n.new('ShaderNodeVolumeScatter'); scatter.inputs['Color'].default_value = (0.25, 0.5, 1.0, 1); scatter.inputs['Anisotropy'].default_value = 0.2
    L.new(k.outputs[0], scatter.inputs['Density'])
    absorb = n.new('ShaderNodeVolumeAbsorption'); absorb.inputs['Color'].default_value = (0.9, 0.7, 0.5, 1)
    k2 = n.new('ShaderNodeMath'); k2.operation = 'MULTIPLY'; k2.inputs[1].default_value = 0.25
    L.new(dens.outputs[0], k2.inputs[0]); L.new(k2.outputs[0], absorb.inputs['Density'])
    add = n.new('ShaderNodeAddShader')
    L.new(scatter.outputs[0], add.inputs[0]); L.new(absorb.outputs[0], add.inputs[1])
    out = n.new('ShaderNodeOutputMaterial')
    L.new(add.outputs[0], out.inputs['Volume'])
    return mat


def emission(name, rgb, strength):
    mat = bpy.data.materials.new(name)
    t = nodes_of(mat)
    em = t.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*rgb, 1)
    em.inputs['Strength'].default_value = strength
    out = t.nodes.new('ShaderNodeOutputMaterial')
    t.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


def principled(name, rgb, rough=0.5, metal=0.0):
    mat = bpy.data.materials.new(name)
    t = nodes_of(mat)
    b = t.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    out = t.nodes.new('ShaderNodeOutputMaterial')
    t.links.new(b.outputs[0], out.inputs['Surface'])
    return mat


# ---------------------------------------------------------------- orbitals

def add_mesh(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(mat)
    return obj


def ring(r0, r1, segments, mat, z=0.0):
    verts, faces = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        verts += [(math.cos(a) * r0, math.sin(a) * r0, z), (math.cos(a) * r1, math.sin(a) * r1, z)]
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    return verts, faces


def build_orbitals(level, cities, login):
    rand = mulberry(fnv(login + ':civ'))
    lamp = emission('Lamp', (1.0, 0.78, 0.5), 30.0)
    white = emission('Beacon', (0.8, 0.9, 1.0), 25.0)
    if level >= 2:
        for i in range(90 if level >= 7 else 3 + level * 5):
            a = rand() * math.tau
            inc = (rand() - 0.5) * 1.2
            rr = R * (1.18 + rand() * 0.5)
            p = Vector((math.cos(a) * rr, math.sin(a) * rr * math.cos(inc), math.sin(a) * rr * math.sin(inc)))
            bpy.ops.mesh.primitive_cube_add(size=R * 0.006, location=p)
            bpy.context.active_object.data.materials.append(white)
    if level >= 3:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=R * 0.2, location=(R * -2.9, R * 1.9, R * 0.6), segments=64, ring_count=32)
        moon = bpy.context.active_object
        moon.data.materials.append(principled('Moon', (0.4, 0.39, 0.38), rough=0.95))
        for poly in moon.data.polygons:
            poly.use_smooth = True
    if level >= 5:
        panels = principled('RingPanels', (0.07, 0.075, 0.09), rough=0.35, metal=0.8)
        v, f = ring(R * 1.62, R * 1.7, 512, panels)
        add_mesh('Orbital ring', v, f, panels)
        # lamp strip along the ring
        v, f = ring(R * 1.655, R * 1.665, 512, lamp, z=R * 0.002)
        strip = add_mesh('Ring lamps', v, [face for k, face in enumerate(f) if k % 8 == 0], lamp)
        port = sorted(cities[:6], key=lambda c: abs(c['dir'].y))[0] if cities else None
        if port:
            d = Vector((port['dir'].x, -port['dir'].z, port['dir'].y))  # web y-up -> Blender z-up (Rx 90°)
            flat = Vector((d.x, d.y, 0)).normalized()
            base, top = d * R * 1.01, flat * R * 1.62
            mid = (base + top) / 2
            length = (top - base).length
            bpy.ops.mesh.primitive_cylinder_add(radius=R * 0.0025, depth=length, location=mid, vertices=8)
            cable = bpy.context.active_object
            cable.rotation_mode = 'QUATERNION'
            cable.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((top - base).normalized())
            cable.data.materials.append(emission('Elevator', (0.85, 0.92, 1.0), 12.0))
    if level >= 7:
        panels2 = principled('RingPanels2', (0.08, 0.08, 0.1), rough=0.35, metal=0.8)
        v, f = ring(R * 1.9, R * 1.96, 512, panels2)
        second = add_mesh('Second ring', v, f, panels2)
        second.rotation_euler = (math.radians(60), math.radians(23), 0)
        v, f = ring(R * 1.925, R * 1.935, 512, lamp, z=R * 0.002)
        lamps2 = add_mesh('Second ring lamps', v, [face for k, face in enumerate(f) if k % 8 == 0], lamp)
        lamps2.rotation_euler = second.rotation_euler
    if level >= 6:
        station = principled('Station', (0.75, 0.76, 0.8), rough=0.3, metal=0.9)
        for i in range(24):
            a = i / 24 * math.tau + rand() * 0.1
            bpy.ops.mesh.primitive_cube_add(size=R * 0.03, location=(math.cos(a) * R * 1.66, math.sin(a) * R * 1.66, 0))
            bpy.context.active_object.data.materials.append(station)


# ---------------------------------------------------------------- scene

def setup(args, main_lang):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    device = 'CPU'
    for kind in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                device = 'GPU'
                break
        except TypeError:
            continue
    scene.cycles.device = device
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 2
    w, h = (int(v) for v in args.res.lower().split('x'))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 92
    scene.render.filepath = os.path.abspath(args.out)
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Punchy'
    except TypeError:
        pass

    world = bpy.data.worlds.new('Space')
    scene.world = world
    t = nodes_of(world)
    bg = t.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 0.06
    star_path = os.path.abspath('.cache/assets/starmap_2020_4k.exr')
    if os.path.exists(star_path):
        env = t.nodes.new('ShaderNodeTexEnvironment')
        env.image = bpy.data.images.load(star_path)
        t.links.new(env.outputs['Color'], bg.inputs['Color'])
    else:
        bg.inputs['Color'].default_value = (0, 0, 0, 1)
    out = t.nodes.new('ShaderNodeOutputWorld')
    t.links.new(bg.outputs[0], out.inputs['Surface'])

    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.5
    sun.angle = math.radians(0.6)
    sun_obj = bpy.data.objects.new('Sun', sun)
    # light from behind-left: a crescent of day, the rest night with city lights
    sun_obj.rotation_euler = (math.radians(80), math.radians(0), math.radians(118))
    scene.collection.objects.link(sun_obj)

    cam_data = bpy.data.cameras.new('Camera')
    cam_data.lens = 42
    cam = bpy.data.objects.new('Camera', cam_data)
    cam.location = (R * 0.2, -R * 3.9, R * 1.05)
    scene.collection.objects.link(cam)
    target = bpy.data.objects.new('Target', None)
    target.location = (R * 0.45, 0, -R * 0.05)
    scene.collection.objects.link(target)
    track = cam.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    scene.camera = cam

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
    glare.inputs['Threshold'].default_value = 1.2
    glare.inputs['Strength'].default_value = 0.5
    out = tree.nodes.new('NodeGroupOutput')
    tree.links.new(layers.outputs['Image'], glare.inputs['Image'])
    tree.links.new(glare.outputs['Image'], out.inputs['Image'])
    scene.compositing_node_group = tree
    print(f'Rendering {w}x{h}, {args.samples} samples on {device}')


def main():
    args = parse_args()
    with open(args.planet, encoding='utf-8') as fh:
        planet = json.load(fh)
    stars = sum(r['s'] for r in planet['repos'])
    level = max(i for i, m in enumerate(LEVELS) if stars >= m)
    print(f"@{planet['login']}: {stars} stars, level {level}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    langs = {}
    for r in planet['repos']:
        if r.get('lang'):
            langs[r['lang']] = langs.get(r['lang'], 0) + r['s']
    main_lang = max(langs, key=langs.get) if langs else 'Python'
    terrain = Terrain(planet['login'], STYLES.get(main_lang, STYLES['Python'])[2])
    cities = place_cities(planet, terrain)
    world_obj, main_lang = build_planet(planet, terrain, cities, level, args.subdiv)
    world_obj.rotation_euler = (math.radians(90), 0, 0)  # web y-up -> Blender z-up

    bpy.ops.mesh.primitive_uv_sphere_add(radius=R * 1.012, segments=128, ring_count=64)
    clouds = bpy.context.active_object
    clouds.data.materials.append(cloud_material(fnv(planet['login']) * 10))
    for poly in clouds.data.polygons:
        poly.use_smooth = True

    bpy.ops.mesh.primitive_uv_sphere_add(radius=R * 1.08, segments=96, ring_count=48)
    bpy.context.active_object.data.materials.append(atmosphere_material())

    build_orbitals(level, cities, planet['login'])
    setup(args, main_lang)
    bpy.ops.render.render(write_still=True)
    print(f'Wrote {args.out}')


main()
