/* ============================================================
   character/loader.js — ロード/破棄処理
   ------------------------------------------------------------
   PMX(MMD)または2Dスプライトのキャラクターをロードする共通ヘルパーと、
   シーンからの除去・GPUリソース解放処理。main.js(切替式選択)・
   dev.js(PC開発者モード)の両方から共通して使う。
   ============================================================ */
import * as THREE from 'three';
import { MMDCharacter } from './mmd-character.js';
import { SpriteCharacter } from './sprite-character.js';
import { softenMaterials } from './material-utils.js';

/**
 * MMDCharacter/SpriteCharacterをシーンから除去し、GPUリソース
 * (ジオメトリ/マテリアル/テクスチャ)を解放する。
 */
export function disposeCharacter(character, scene) {
  if (!character || !character.root) return;
  scene.remove(character.root);
  character.root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat) return;
        Object.keys(mat).forEach((key) => {
          const val = mat[key];
          if (val && val.isTexture) val.dispose();
        });
        if (mat.gradientMap && mat.gradientMap.isTexture) mat.gradientMap.dispose();
        mat.dispose();
      });
    }
  });
}

/**
 * PMX(MMD)または2Dスプライトのキャラクターをロードする共通ヘルパー。
 * @param {object} def CHARACTERS配列の1エントリ
 * @param {object} deps { MMDLoader, scene }
 */
export function loadCharacter(def, { MMDLoader, scene }, callbacks = {}) {
  const { onProgress, onError } = callbacks;
  if (def.type === 'mmd') {
    const loader = new MMDLoader();
    loader.load(
      def.path,
      (mesh) => {
        scene.add(mesh);
        softenMaterials(mesh);
        // ShadowRig(Directional Shadow)の光源から影を落とせるようにする。
        // renderer.shadowMap.enabledがfalseの環境(dev.js等)では無害。
        mesh.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });
        const character = new MMDCharacter(mesh, def);
        if (callbacks.onLoad) callbacks.onLoad(character);
      },
      (xhr) => { if (onProgress) onProgress(xhr); },
      (err) => { if (onError) onError(err); }
    );
  } else if (def.type === 'sprite') {
    const texLoader = new THREE.TextureLoader();
    texLoader.load(def.path, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = tex.image.width / tex.image.height;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      scene.add(sprite);
      const character = new SpriteCharacter(sprite, { ...def, aspect });
      if (callbacks.onLoad) callbacks.onLoad(character);
    });
  }
}
