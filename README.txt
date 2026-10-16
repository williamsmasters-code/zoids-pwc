ZOID MERCENARIES
Personal non-commercial browser proof of concept.
MechWarrior-style contracts, piloting mock Zoids built from basic shapes.

RUN
  cd into this directory and start a static server:

    python3 -m http.server 8080

  Open http://localhost:8080
  No build step. three.js r170 is vendored at vendor/three.module.js and
  loaded with an import map. The page is plain ES modules.

  Tests (Node 20, and Chrome for the browser pass):

    npm install
    npm test

  That runs tests/damage.test.mjs, tests/models_check.mjs, and
  tests/headless.mjs. The browser test serves this directory on port 8080,
  so stop any other server on that port first. Screenshots land in
  screenshots/hangar.png and screenshots/mission.png.

CONTROLS
  Hangar: click a Zoid, buy and equip gear, then Launch a contract.
  In the field, click the view to capture the mouse.

    W / S or arrow up / down   throttle
    A / D                      strafe
    Mouse                      look (pointer lock)
    Arrow left / right         look without the mouse
    Left mouse or 1            weapon group 1
    Right mouse or 2           weapon group 2
    3 / 4                      weapon groups 3 and 4
    Shift                      boost, if back boosters are fitted and the back mount stands
    V                          first person / third person
    Tab                        cycle target
    R                          nearest hostile
    H                          control list
    Esc                        pause and release the mouse

  WASD follows the chassis. The torso and the camera follow the mouse, and
  the legs catch up at the Zoid's turn rate. There is no overall health bar.

FEATURES
  Eight playable Zoids: Shield Liger, Blade Liger, Command Wolf, Gojulas,
  Zaber Fang, Iron Kong, Geno Saurer, Death Saurer. Each has its own speed,
  turn rate, armor scale, hardpoints, weight, and price.
  Hangar loadout: weapons, per-part armor plating, speed gyros, maneuver
  gyros, and back boosters. Weight and hardpoint size are enforced.
  Money is in C-bills and is stored in localStorage under zoidMercs.save.v1,
  with the owned Zoids and their loadouts.
  Damage is per part (head, core, legs, tail, weapon mounts, back mount).
  Armor is lost first, then structure. A destroyed leg slows speed and turn.
  A damaged head scrambles the HUD and shortens sensor range. A destroyed
  mount disables the weapons on it. Boosters die with the back mount.
  Core destruction destroys the Zoid. The Shield Liger's left foreleg, while
  it still stands, reduces damage from attackers in front of it.
  The HUD paper doll shows the player and the locked target, color coded.
  Three open biomes: Red Dune Expanse, Verdant Reach, White Shelf. A few
  rocks and ridges, large terrain, distance fog.
  Contracts: destroy a lance, escort supply trucks, scan three beacons, or
  assault a generator. Win for a payout and a small salvage bonus, then pay
  repair costs or take a field loan if the core is gone. Enemy Zoids move,
  flank, aim, and shoot.

MOCK MODELS
  No licensed meshes and no image textures. Every Zoid is boxes, cylinders,
  cones, and a few toruses, parented so local -Z is forward and left is -X.
  Lions, the wolf, and the saber-tooth are quadrupeds. Iron Kong is a gorilla.
  Geno Saurer, Gojulas, and Death Saurer are bipedal theropods. Colors and
  silhouettes stand in for the real machines: white-blue shield, blue blades,
  grey wolf with a dish, red saber fangs, olive siege walker, purple super
  heavy, and so on. Legs swing while moving. Parts are separate named meshes.

KNOWN GAPS
  These are not the official Zoid models, only recognizable mockups.
  No multiplayer, no melee, and no active shield toggle beyond the Shield
  Liger's passive frontal reduction.
  Weapons have no ammo count. Heat is the limit, and there is no magazine.
  Salvage is a C-bill bonus, not a recovered weapon.
  Enemy pilots are simple: close, circle, face the target, fire in range.
  Mission variety is four contract types on three heightfield maps.
  Sound is short synthesized beeps. There is no music.
  Keyboard and mouse only. No joystick.
  Terrain collision is a radial rock and an axis-aligned building. Ridges
  are decorative. The first-person view is a camera at the head, not a
  cockpit interior.
  Friendly fire is possible. The convoy trucks do not fight.
