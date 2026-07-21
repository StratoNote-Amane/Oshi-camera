/* ============================================================
   character/sprite-character.js — 2D透過素材キャラクター
   ------------------------------------------------------------
   将来的な2D透過素材対応のためのフォールバック実装。
   MMDCharacterと同じsetTransform/getFootY/getWidth/setExpression/
   setPose/getCurrentPoseBoneNames/updateインターフェースを持つ。
   ============================================================ */
export class SpriteCharacter {
  constructor(sprite, def) {
    this.root = sprite;
    this.heightMeters = def.heightMeters;
    this.aspect = def.aspect;
    sprite.center.set(0.5, 0);
  }
  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.material.rotation = rotY;
    const h = this.heightMeters * scale;
    this.root.scale.set(h * this.aspect, h, 1);
  }
  getFootY() { return this.root.position.y; }
  getWidth() { return this.root.scale.x; }
  setExpression() {}
  setPose() {}
  getCurrentPoseBoneNames() { return []; }
  update() {}
}
