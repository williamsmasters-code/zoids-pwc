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

  That runs tests/damage.test.mjs, tests/aim.test.mjs, tests/input.test.mjs,
  tests/reset.test.mjs, tests/models_check.mjs, tests/heat.test.mjs,
  tests/skills.test.mjs, tests/indicators.test.mjs, and tests/headless.mjs.
  The browser test serves this directory on port 8080, so stop any other
  server on that port first. Screenshots land in screenshots/.

CONTROLS
  Hangar: click a Zoid, buy and equip gear, then Launch a contract.
  In the field, click the view to capture the mouse.

    W / S or arrow up / down   throttle
    A / D                      strafe
    Mouse                      look (pointer lock)
    Arrow left / right         look without the mouse
    Left mouse or 1            weapon group 1
    Right mouse or 2           weapon group 2 (the browser menu is cancelled)
    3 / 4                      weapon groups 3 and 4
    Q                          active skill

  The crosshair is the center of the screen in both camera modes. Each
  weapon fires from its own mount toward the world point under that
  crosshair. If the center ray hits nothing, the mounts aim 1000 m out
  along it. The player's own Zoid is ignored by that ray. The weapon dock
  shows groups 1-4 as ready, cooling, overheated, disabled, or empty.
  Each weapon has its own heat gauge, heat per shot, and cooling rate.
  A weapon that reaches 100 heat locks until it cools below 55. The other
  weapons keep firing. The PEAK bar is the hottest weapon, not a shared pool.
    Shift                      boost, if back boosters are fitted and the back mount stands
    V                          first person / third person
    Tab                        cycle target
    R                          nearest hostile
    H                          control list, including every Zoid skill
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
  with the owned Zoids and their loadouts. Reset company asks for
  confirmation, then deletes that save and any other zoidMercs.* key and
  rebuilds the starting hangar.
  Damage is per part (head, core, legs, tail, weapon mounts, back mount).
  Armor is lost first, then structure. A destroyed leg slows speed and turn.
  A damaged head scrambles the HUD and shortens sensor range. A destroyed
  mount disables the weapons on it. Boosters die with the back mount.
  Core destruction destroys the Zoid.
  Survey beacons, escort exits, and assault generators plant a tall light
  pillar with fog disabled, plus a bright marker and distance label that
  draw through the world. If the objective is off screen, behind the camera,
  or past radar range, an arrow with the distance sits on the screen edge.
  The minimap keeps that contact clamped to its own edge.
  The HUD paper doll shows the player and the locked target, color coded.
  Three open biomes: Red Dune Expanse, Verdant Reach, White Shelf. A few
  rocks and ridges, large terrain, distance fog.
  Contracts: destroy a lance, escort supply trucks, scan three beacons, or
  assault a generator. Win for a payout and a small salvage bonus, then pay
  repair costs or take a field loan if the core is gone. Enemy Zoids move,
  flank, aim, and shoot. Enemy pilots may use their Zoid skill when a target
  is close. A missing skill does nothing.

SKILLS
  Q is the active skill. The HUD names it and shows cooldown or heat.
  The hangar lists the passive and the active on the Zoid you are viewing.
  The Shield Liger shield is a toggle. Weapons cannot fire while it is up.

  Command Wolf
    Passive  Pack Sensors. Radar and target lock reach 35% farther, and HUD
             scramble is cut by a third.
    Active   Sensor Lock. For 6 seconds radar and lock reach twice as far again.
    Cost     cooldown 14s
  Zaber Fang
    Passive  Predator Stride. Top speed is 12% higher.
    Active   Speed Burst. For 4 seconds speed is multiplied by 1.55.
    Cost     cooldown 9s
  Shield Liger
    Passive  Shield Plate. While the left foreleg stands, front-arc hits deal
             70% damage.
    Active   Energy Shield. Toggle. Blocks 100% of front-arc damage. Weapons
             cannot fire while it is up. Heat rises at 36 per second.
    Cost     lockout until the gauge cools below 55, plus 2.5s
  Blade Liger
    Passive  Blade Tempo. Above 8 m/s, incoming damage is reduced by 12%.
    Active   Laser Blade. Dash 18 m forward and slash 32 damage in a front cone.
    Cost     cooldown 7s
  Iron Kong
    Passive  Plate Armor. Incoming damage is reduced by 10%.
    Active   Ground Pound. 24 damage within 12 m, then 20% less damage taken
             for 4 seconds.
    Cost     cooldown 11s
  Geno Saurer
    Passive  Particle Vent. Energy weapons cool 30% faster.
    Active   Particle Cannon. A built-in bolt for 70 damage out to 160 m.
    Cost     70 skill heat, locked until heat falls below 40, cooldown 4s
  Gojulas
    Passive  Siege Brace. Below 6 m/s, incoming damage is cut by 15% and
             weapon spread tightens.
    Active   Artillery Barrage. Five shells at the aim point, 16 damage each.
    Cost     cooldown 12s
  Death Saurer
    Passive  Super Heavy Frame. Incoming damage is reduced by 18%.
    Active   Overload. For 6 seconds weapons hit 40% harder, build 50% more
             heat, and incoming damage drops a further 15%.
    Cost     cooldown 10s

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
  No multiplayer. Melee is the Blade Liger's laser-blade dash only.
  Weapons have no ammo count. Heat is per weapon, and there is no magazine.
  Salvage is a C-bill bonus, not a recovered weapon.
  Enemy pilots are simple: close, circle, face the target, fire in range.
  Mission variety is four contract types on three heightfield maps.
  Sound is short synthesized beeps. There is no music.
  Keyboard and mouse only. No joystick.
  Terrain collision is a radial rock and an axis-aligned building. Ridges
  are decorative. The first-person view is a camera at the head, not a
  cockpit interior.
  Friendly fire is possible. The convoy trucks do not fight.
