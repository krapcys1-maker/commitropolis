import * as THREE from 'three';
import { createGroundMaterial, createSkyMaterial } from './materials.js';

// Night: sky dome with a glowing horizon, fog matched to it, moonlight, an environment map made
// from the sky (so glass reflects the night), and a gridded ground.
export class Atmosphere {
  constructor(renderer, scene, uniforms) {
    this.uniforms = uniforms;
    this.uniforms.uCitySize = { value: 200 };

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial(uniforms));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    envSky.scale.setScalar(10);
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();

    scene.fog = new THREE.FogExp2(new THREE.Color(0.012, 0.011, 0.026), 0.002);

    scene.add(new THREE.HemisphereLight(0x4a5a90, 0x06060c, 0.55));
    this.moon = new THREE.DirectionalLight(0xa8b8ff, 0.7);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.02;
    scene.add(this.moon, this.moon.target);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createGroundMaterial(this.uniforms));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    scene.add(this.ground);
  }

  fitCity(size, scene) {
    this.uniforms.uCitySize.value = size;
    this.ground.scale.set(size * 12, size * 12, 1);
    scene.fog.density = 0.32 / size;
    this.moon.position.set(-size * 0.45, size * 0.9, size * 0.35);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -size * 0.75;
    sc.right = sc.top = size * 0.75;
    sc.near = 1;
    sc.far = size * 3;
    sc.updateProjectionMatrix();
  }

  follow(camera) {
    this.sky.position.copy(camera.position);
  }
}
