/**
 * BootScene — the first scene. All art is generated in code, so there's nothing to
 * load yet; this immediately hands off to the Menu. (When real assets are added later,
 * they load here in preload().)
 */
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create(): void {
    this.scene.start('Menu');
  }
}
