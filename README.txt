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
  tests/skills.test.mjs, tests/indicators.test.mjs, tests/weapons.test.mjs,
  tests/glb.test.mjs, tests/headless.mjs, and tests/glb_browser.mjs.
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
  along it. The player's own Zoid is ignored by that ray. Beams use that
  ray directly. Ballistic guns raise the barrel so the shell's arc passes
  through the same point when a solution exists. The weapon dock shows
  groups 1-4 as ready, cooling, charging, overheated, disabled, or empty,
  plus that group's max range.
  Each weapon has its own heat gauge, heat per shot, and cooling rate.
  A weapon that reaches 100 heat locks until it cools below 55. The other
  weapons keep firing. The PEAK bar is the hottest weapon, not a shared pool.
    Shift                      boost, if back boosters are fitted and the back mount stands
    V                          first person / third person
    Tab                        cycle target
    R                          nearest hostile
    H                          control list, weapon rules, and every Zoid skill
    Esc                        pause and release the mouse

  WASD follows the chassis. The torso and the camera follow the mouse, and
  the legs catch up at the Zoid's turn rate. There is no overall health bar.

WEAPONS
  Four deliveries. Keyboard and mouse only. Heat and crosshair aim stay.

  Beam. Pulse Laser and Beam Cannon. The shot is hitscan: damage lands
  along the aim ray in the same instant, with a brief tracer. No travel
  time and no drop.

  Ballistic. Gatling Gun and Shock Cannon. A real shell with speed and
  gravity (12 m/s^2). The barrel is elevated by the low-arc solution so
  the shell meets the crosshair point when the gun can reach it. The HUD
  shows that impact, a drop marker for an uncompensated shot, and a lead
  bracket from the target's velocity and the shell speed. Drop and travel
  time make close, fast targets harder.

  Rocket. Missile Pack. Homing, but it will not launch until a lock
  finishes. The lock takes 1.5 s on a still target under the crosshair, or
  on the targeted enemy when that enemy is within about 6 degrees of the
  crosshair. Strength is 1 at 0 m/s and 0 at 30 m/s, and the lock builds at
  strength / 1.5 s. A target at 30 m/s or more breaks a lock and cannot be
  tracked. There is no dumb-fire. A locked missile pops upward for 0.52 s,
  then arcs down. Turn rate is 0.6 + strength * 3.2, so a fast target is
  easy to miss.

  Charge. Charged Particle Cannon. Hold the fire button for 3 seconds
  while stationary (planar speed under 0.75 m/s). The charge bar fills.
  Releasing early or moving clears it and does not fire. At 3.0 s, still
  held and still stopped, it fires a full-power hitscan bolt by itself.
  Partial charge never fires. Geno Saurer's Particle Cannon skill is a
  separate instant bolt on Q. Q is a tap, not a hold, so that skill does
  not use this 3 second rule.

  Range. Every weapon has its own optimal range and a hard max. Damage is
  full up to optimal, falls linearly to 30% at the max, and is zero past
  it. The hangar cards, the equipped readout, and the weapon dock list the
  max. If the locked target is past a group's max, that dock row reads
  OUT OF RANGE. If it is past every fitted weapon, the crosshair turns red
  and the target line says OUT OF RANGE. Sensor range is a different line:
  OUT OF SENSOR RANGE.

  Pulse Laser              beam       opt 50 m    max 85 m    hitscan
  Beam Cannon              beam       opt 90 m    max 150 m   hitscan
  Gatling Gun              ballistic  opt 40 m    max 110 m   170 m/s
  Shock Cannon             ballistic  opt 60 m    max 130 m   82 m/s
  Missile Pack             rocket     opt 80 m    max 200 m   lock 1.5 s, 68 m/s, volley 4
  Charged Particle Cannon  charge     opt 110 m   max 220 m   hold 3 s, then hitscan

FEATURES
  Thirteen playable Zoids: Shield Liger, Blade Liger, Command Wolf, Gojulas,
  Zaber Fang, Iron Kong, Geno Saurer, Death Saurer, Gun Sniper, Elephander,
  Berserk Fuhrer, Molga, Pteras. Each has its own speed,
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
    Active   Particle Cannon. An instant bolt for 70 damage out to 160 m.
             Q is a tap, so this is not the mounted cannon's 3 second charge.
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
  Gun Sniper      Sniper Optics (+25% radar) / Steady Aim (+30% damage 5 s, cd 12s)
  Elephander      Elephant Hide (-14% damage taken) / Stampede (30 dmg in 14 m, cd 12s)
  Berserk Fuhrer  Berserk Drive (+8% speed) / Buster Claw Charge (16 m dash, 36 dmg, cd 8s)
  Molga           Segmented Armor (brace below 6 m/s) / Ram (14 m charge, 26 dmg, cd 9s)
  Pteras          Sky Eye (+30% radar) / Bombing Run (4 bombs x 14 dmg, cd 11s)

MODELS
  Command Wolf, Shield Liger, Blade Liger, Iron Kong, and Geno Saurer load
  Sketchfab meshes from assets/models (see CREDITS.txt). They face local -Z,
  stand on y = 0, and are split into the same named damage parts as the mocks.
  Shield Liger prefers assets/models/shield-liger-anim.glb, a rigid skin with
  Idle, Walk, Run, ShieldActivate, ShieldMaintain, and Fire. If that file
  fails it uses the static shield-liger.glb, then the procedural mock. The
  other four files are static. Zaber Fang, Gojulas, and Death Saurer stay
  boxes, cylinders, and cones. Add ?mock=1 to the page address to force the
  procedural model for every Zoid. If a GLB fails to load, that Zoid falls
  back to its mock. The hangar footer opens the credit list.
  Lions, the wolf, and the saber-tooth are quadrupeds. Iron Kong is a gorilla.
  Geno Saurer, Gojulas, and Death Saurer are bipedal theropods. Mock-only
  machines keep their colored silhouettes: red saber fangs, olive siege
  walker, purple super heavy. Procedural legs swing while moving. The Shield
  Liger plays its skeletal clips instead: idle, a diagonal walk, a bounding
  run, the energy-shield deploy, and a firing recoil. The hangar preview
  loops the walk. Q still toggles the energy shield, and weapons do not fire
  while it is up. Rebuild the animated file from the repo root:
    /workspace/tools/blender-4.5.14-linux-x64/blender -b --python tools/rig_shield_liger.py

MODEL CREDITS
  License for all five meshes: CC-BY-4.0
  http://creativecommons.org/licenses/by/4.0/
  Changes: scaled/split/optimized/stripped helper nodes

  Zoids Blade Liger
    guntuy3 — https://sketchfab.com/guntuy3
    https://sketchfab.com/3d-models/zoids-blade-liger-d4caf50b3c934b2ba29fd2f25d730f28
  Shield Liger WIP
    hdbanks1 — https://sketchfab.com/hdbanks1
    https://sketchfab.com/3d-models/shield-liger-wip-c903bfa399194201a0cb649311ec308f
    Changes: scaled/split/optimized/stripped helper nodes; rigged with armature, split into segments, animated
    Rebuild: /workspace/tools/blender-4.5.14-linux-x64/blender -b --python tools/rig_shield_liger.py
  Genosaurer Zoids (free)
    Anderson455 — https://sketchfab.com/pablo.gabriel87
    https://sketchfab.com/3d-models/genosaurer-zoids-free-3b7075f3b14a4022ad3996e0eda8ca88
  Command Wolf
    Warner's Digital Art — https://sketchfab.com/warnerdraws
    https://sketchfab.com/3d-models/command-wolf-a69dcd74f065467981aaf3d9dc913b59
  Iron Kong - Zoids
    Anderson123 — https://sketchfab.com/Mr_Anderson123
    https://sketchfab.com/3d-models/iron-kong-zoids-74a45b6ead5f4f21bc6df68c9ca9bd9a

KNOWN GAPS
  Five Zoids use CC-BY Sketchfab meshes that were scaled, split, and
  compressed for the browser. They are not the official product models.
  The Shield Liger rig is a rigid split by region, not a hand-weighted
  skeleton. Small shards can sit off a limb, and the mane plates are the
  regions that could be separated cleanly.
  Zaber Fang, Gojulas, and Death Saurer are still recognizable mockups.
  Gun Sniper, Elephander, Berserk Fuhrer, Molga, and Pteras are original
  procedural models made for this project (no free CC-BY/CC0 model of them
  was found). Pteras flies at a low fixed height (flyHeight in js/catalog.js).
  See docs/NEW_ZOIDS_NOTES.txt.
  No multiplayer. Melee is the Blade Liger's laser-blade dash only.
  Weapons have no ammo count. Heat is per weapon, and there is no magazine.
  Beams hit instantly. Cannons and the gatling drop. Missiles need a 1.5 s
  lock and cannot launch without one. The charged particle cannon fires
  only after a 3 s stationary hold. Enemy pilots carrying that cannon stop
  to brace while the target is in range.
  Salvage is a C-bill bonus, not a recovered weapon.
  Enemy pilots are simple: close, circle, face the target, fire in range.
  Mission variety is four contract types on three heightfield maps.
  Sound is short synthesized beeps. There is no music.
  Keyboard and mouse only. No joystick.
  Terrain collision is a radial rock and an axis-aligned building. Ridges
  are decorative. The first-person view is a camera at the head, not a
  cockpit interior.
  Friendly fire is possible. The convoy trucks do not fight.
