#!/usr/bin/env python3
"""Rig and animate the Shield Liger, then write assets/models/shield-liger-anim.glb.

The source is a static Sketchfab mesh (CC-BY-4.0, hdbanks1). This script:

  1. Imports the original GLB and bakes the Sketchfab root (-90 deg X).
  2. Turns the nose to Blender +Y (glTF -Z after export), puts the feet on Z = 0,
     centers X/Y, and scales the longest axis to the mock length 5.89.
     The game still multiplies by ZOIDS.shieldLiger.scale, same as the static file.
  3. Decimates to about 70k triangles, then splits faces by centroid into the
     damage parts and the mechanical segments those parts are made of.
  4. Builds a rigid armature (weight 1, no stretch) and keys six actions at 24 fps:
     Idle, Walk, Run, ShieldActivate, ShieldMaintain, Fire.
  5. Exports a skinned GLB and meshopt-compresses it with
     tools/compress_shield_anim.mjs. The static assets/models/shield-liger.glb
     is left in place as the fallback.

Rebuild (Blender 4.5, headless):

  /workspace/tools/blender-4.5.14-linux-x64/blender -b --python tools/rig_shield_liger.py

Run it from the repository root. gltf-transform installs into /tmp/gltf-tools,
which is not part of the game repo.
"""

import os
import subprocess
import sys
import traceback

import bpy
from mathutils import Matrix, Vector, Quaternion

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SOURCE = "/workspace/zoids_models/m_01M542FS6N6H6CWBDH7AKB6HS7.glb"
RAW = "/tmp/shield-liger-anim-raw.glb"
OUT = os.path.join(ROOT, "assets", "models", "shield-liger-anim.glb")
SHOTS = os.path.join(ROOT, "screenshots", "shield-liger-anim")
BLENDER = "/workspace/tools/blender-4.5.14-linux-x64/blender"
MOCK_LONG = 5.89
FPS = 24

# Damage-part ids the game already understands. Segment suffixes stay on the
# object name; the partId custom property is what the loader trusts.
PARTS = [
    "head", "core",
    "leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg",
    "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon",
]

LEG_NAMES = ["leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg"]


def log(msg):
    print(msg, flush=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_and_join():
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no meshes in the source GLB")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    keep = {joined}
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return joined


def mesh_bounds(obj):
    xs, ys, zs = [], [], []
    for vert in obj.data.vertices:
        xs.append(vert.co.x)
        ys.append(vert.co.y)
        zs.append(vert.co.z)
    mn = Vector((min(xs), min(ys), min(zs)))
    mx = Vector((max(xs), max(ys), max(zs)))
    return mn, mx


def orient_and_scale(obj):
    """Match the optimizer: nose to glTF -Z, feet on y = 0, longest side 5.89.

    After Blender's importer and Apply Transform, this file sits with width on
    X, height on Y (top toward -Y), length on Z (nose toward -Z). The matrix
    below is a proper rotation into Blender Z-up / +Y-forward, which the glTF
    exporter turns back into Y-up / -Z-forward.
    """
    # (x, y, z) -> (-x, -z, -y)
    orient = Matrix((
        (-1, 0, 0, 0),
        (0, 0, -1, 0),
        (0, -1, 0, 0),
        (0, 0, 0, 1),
    ))
    obj.data.transform(orient)
    obj.data.update()
    mn, mx = mesh_bounds(obj)
    center_x = (mn.x + mx.x) * 0.5
    center_y = (mn.y + mx.y) * 0.5
    obj.data.transform(Matrix.Translation(Vector((-center_x, -center_y, -mn.z))))
    obj.data.update()
    mn, mx = mesh_bounds(obj)
    # Heavier front-upper flank goes to -X, same rule as tools/optimize_models.mjs.
    left = right = 0
    span_x = (mx.x - mn.x) or 1
    span_y = (mx.y - mn.y) or 1
    span_z = (mx.z - mn.z) or 1
    for poly in obj.data.polygons:
        c = poly.center
        u = (c.x - mn.x) / span_x
        v = (c.z - mn.z) / span_z
        w = (mx.y - c.y) / span_y
        if v < 0.3 or w > 0.45:
            continue
        if u < 0.28:
            left += 1
        elif u > 0.72:
            right += 1
    if right > left * 1.25:
        obj.data.transform(Matrix.Diagonal(Vector((-1, 1, 1, 1))))
        obj.data.flip_normals()
        obj.data.update()
        mn, mx = mesh_bounds(obj)
        center_x = (mn.x + mx.x) * 0.5
        obj.data.transform(Matrix.Translation(Vector((-center_x, 0, 0))))
        obj.data.update()
        mn, mx = mesh_bounds(obj)
        log(f"mirrored X so the heavier flank is on the left ({right} vs {left})")
    size = mx - mn
    scale = MOCK_LONG / max(size.x, size.y, size.z)
    obj.data.transform(Matrix.Scale(scale, 4))
    obj.data.update()
    mn, mx = mesh_bounds(obj)
    log(f"normalized size {(mx - mn).x:.2f} {(mx - mn).z:.2f} {(mx - mn).y:.2f} (x, up, length) scale {scale:.4f}")
    return mn, mx


def decimate(obj, target=70000):
    faces = len(obj.data.polygons)
    if faces <= target * 1.05:
        log(f"decimate skipped, {faces} faces")
        return
    ratio = target / faces
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"decimate {faces} -> {len(obj.data.polygons)}")


def bounds_of(mn, mx):
    return {
        "min": mn,
        "max": mx,
        "sx": (mx.x - mn.x) or 1,
        "sy": (mx.y - mn.y) or 1,
        "sz": (mx.z - mn.z) or 1,
    }


def uvw(center, box):
    u = (center.x - box["min"].x) / box["sx"]
    v = (center.z - box["min"].z) / box["sz"]
    w = (box["max"].y - center.y) / box["sy"]
    return u, v, w


def classify(center, box):
    """Return (segment, part_id, bone). w = 0 at the nose, 1 at the tail."""
    u, v, w = uvw(center, box)
    side = "left" if u < 0.5 else "right"

    if w > 0.78 and abs(u - 0.5) < 0.25 and v > 0.40:
        band = min(3, int((w - 0.78) / 0.055))
        return f"tail_{band + 1}", "tail", f"tail{band + 1}"

    front = w < 0.46
    rear = w > 0.54
    leg = None
    if v < 0.20 and (front or rear):
        leg = ("leftFrontLeg" if side == "left" else "rightFrontLeg") if front else (
            "leftRearLeg" if side == "left" else "rightRearLeg"
        )
    elif v < 0.46 and abs(u - 0.5) > 0.14 and (front or rear):
        leg = ("leftFrontLeg" if side == "left" else "rightFrontLeg") if front else (
            "leftRearLeg" if side == "left" else "rightRearLeg"
        )
    if leg:
        if v < 0.14:
            seg, bone = "paw", f"{leg}_paw"
        elif v < 0.24:
            seg, bone = "ankle", f"{leg}_ankle"
        elif v < 0.34:
            seg, bone = "lower", f"{leg}_knee"
        else:
            seg, bone = "upper", f"{leg}_hip"
        return f"{leg}_{seg}", leg, bone

    # Shield plates are thin slices. A big region rotated 70 degrees
    # swings the torso off the body, so these boxes stay small.
    if 0.42 < w < 0.56 and v > 0.82 and abs(u - 0.5) < 0.22:
        return "backMount_panel", "backMount", "backPanel"
    if 0.44 < w < 0.58 and 0.62 < v <= 0.82 and abs(u - 0.5) < 0.12:
        return "backMount_gun", "backMount", "twinGun"
    if 0.16 < w < 0.28 and 0.42 < v < 0.62 and abs(u - 0.5) < 0.12:
        return "headWeapon_chest", "headWeapon", "chestCannon"
    if w < 0.20 and v > 0.88 and abs(u - 0.5) < 0.22:
        return "head_shieldTop", "head", "shieldTop"
    if w < 0.12 and 0.40 < v < 0.58 and abs(u - 0.5) < 0.16:
        return "head_shieldChin", "head", "shieldChin"
    if (u < 0.10 or u > 0.90) and 0.16 < w < 0.42 and v > 0.58:
        part = "leftWeapon" if u < 0.5 else "rightWeapon"
        bone = "shieldLeft" if u < 0.5 else "shieldRight"
        return f"{part}_shield", part, bone
    if w < 0.18 and v > 0.45 and abs(u - 0.5) < 0.42:
        if v < 0.66:
            return "head_jaw", "head", "jaw"
        return "head", "head", "head"
    if abs(u - 0.5) < 0.42 and v > 0.32:
        if w < 0.32:
            return "core_chest", "core", "spine3"
        if w < 0.52:
            return "core_abdomen", "core", "spine2"
        if w < 0.80:
            return "core_pelvis", "core", "spine1"
    return "core_rest", "core", "spine2"


def part_target(part, box):
    spec = {
        "head": (0.50, 0.78, 0.08),
        "headWeapon": (0.50, 0.55, 0.20),
        "core": (0.50, 0.55, 0.45),
        "tail": (0.50, 0.65, 0.90),
        "backMount": (0.50, 0.80, 0.50),
        "leftWeapon": (0.12, 0.62, 0.32),
        "rightWeapon": (0.88, 0.62, 0.32),
        "leftFrontLeg": (0.28, 0.18, 0.28),
        "rightFrontLeg": (0.72, 0.18, 0.28),
        "leftRearLeg": (0.30, 0.18, 0.68),
        "rightRearLeg": (0.70, 0.18, 0.68),
    }[part]
    u, v, w = spec
    return Vector((
        box["min"].x + u * box["sx"],
        box["max"].y - w * box["sy"],
        box["min"].z + v * box["sz"],
    ))


DEFAULT_BONE = {
    "head": "head",
    "headWeapon": "chestCannon",
    "core": "spine2",
    "tail": "tail2",
    "backMount": "backPanel",
    "leftWeapon": "shieldLeft",
    "rightWeapon": "shieldRight",
    "leftFrontLeg": "leftFrontLeg_hip",
    "rightFrontLeg": "rightFrontLeg_hip",
    "leftRearLeg": "leftRearLeg_hip",
    "rightRearLeg": "rightRearLeg_hip",
}


def assign_faces(obj, box):
    faces = []
    for poly in obj.data.polygons:
        seg, part, bone = classify(poly.center, box)
        faces.append({
            "index": poly.index,
            "center": poly.center.copy(),
            "seg": seg,
            "part": part,
            "bone": bone,
        })
    # Pull shards that landed far from their segment back onto a neighbor,
    # so a leg or plate does not leave floating triangles behind.
    med = {}
    buckets = {}
    for face in faces:
        buckets.setdefault(face["seg"], []).append(face)
    for seg, items in buckets.items():
        acc = Vector((0, 0, 0))
        for face in items:
            acc += face["center"]
        med[seg] = acc / len(items)
    moved = 0
    for face in faces:
        if (face["center"] - med[face["seg"]]).length < 0.7:
            continue
        best = None
        best_d = 1e9
        for seg, center in med.items():
            dist = (face["center"] - center).length
            if dist < best_d:
                best_d = dist
                best = seg
        if best and best != face["seg"] and best_d < 0.45:
            host = buckets[best][0]
            face["seg"] = best
            face["part"] = host["part"]
            face["bone"] = host["bone"]
            moved += 1
    if moved:
        log(f"reassigned {moved} outlier faces")
    counts = {part: 0 for part in PARTS}
    for face in faces:
        counts[face["part"]] += 1
    log("part counts " + " ".join(f"{k}:{counts[k]}" for k in PARTS))
    for part in PARTS:
        if counts[part] >= 80:
            continue
        target = part_target(part, box)
        ranked = sorted(faces, key=lambda face: (face["center"] - target).length)
        need = 160 - counts[part]
        stolen = 0
        for face in ranked:
            if stolen >= need:
                break
            if face["part"] == part:
                continue
            if face["part"] == "head" and part != "headWeapon":
                continue
            counts[face["part"]] -= 1
            face["part"] = part
            face["seg"] = f"{part}_fill"
            face["bone"] = DEFAULT_BONE[part]
            counts[part] += 1
            stolen += 1
        log(f"filled {part} with {stolen} faces, now {counts[part]}")
    groups = {}
    for face in faces:
        groups.setdefault(face["seg"], {"part": face["part"], "bone": face["bone"], "indices": []})
        groups[face["seg"]]["indices"].append(face["index"])
        groups[face["seg"]]["bone"] = face["bone"]
        groups[face["seg"]]["part"] = face["part"]
    # Drop shards, but never the last mesh of a damage part.
    part_segs = {}
    for name, group in groups.items():
        part_segs.setdefault(group["part"], []).append(name)
    drop = []
    for name, group in groups.items():
        if len(group["indices"]) >= 40:
            continue
        siblings = [n for n in part_segs[group["part"]] if n != name and len(groups[n]["indices"]) >= 40]
        if not siblings and len(part_segs[group["part"]]) == 1:
            continue
        host = siblings[0] if siblings else "core_rest"
        if host not in groups:
            continue
        groups[host]["indices"].extend(group["indices"])
        drop.append(name)
    for name in drop:
        del groups[name]
    return groups


def extract_objects(src, groups):
    created = []
    src_bm = None
    import bmesh
    for name, group in groups.items():
        bm = bmesh.new()
        bm.from_mesh(src.data)
        bm.faces.ensure_lookup_table()
        keep = set(group["indices"])
        doomed = [face for face in bm.faces if face.index not in keep]
        bmesh.ops.delete(bm, geom=doomed, context="FACES")
        loose = [vert for vert in bm.verts if not vert.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        if not bm.faces:
            bm.free()
            continue
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        for material in src.data.materials:
            obj.data.materials.append(material)
        bpy.context.scene.collection.objects.link(obj)
        obj["partId"] = group["part"]
        obj["bone"] = group["bone"]
        created.append(obj)
    if src_bm:
        src_bm.free()
    bpy.data.objects.remove(src, do_unlink=True)
    log(f"segments {len(created)}")
    return created


def new_bone(arm, name, head, tail, parent, roll):
    bone = arm.edit_bones.new(name)
    bone.head = head
    direction = tail - head
    if direction.length < 0.05:
        direction = Vector((0, 0.2, 0))
    bone.tail = head + direction.normalized() * max(0.12, min(0.55, direction.length))
    bone.parent = parent
    bone.use_connect = False
    try:
        bone.align_roll(roll)
    except Exception:
        pass
    return bone


def build_armature(objects):
    boxes = {}
    for obj in objects:
        mn, mx = mesh_bounds(obj)
        boxes[obj.name] = (mn, mx, (mn + mx) * 0.5)

    def seg_box(prefix):
        hits = [boxes[o.name] for o in objects if o.name.startswith(prefix)]
        if not hits:
            return None
        mn = Vector((min(b[0].x for b in hits), min(b[0].y for b in hits), min(b[0].z for b in hits)))
        mx = Vector((max(b[1].x for b in hits), max(b[1].y for b in hits), max(b[1].z for b in hits)))
        return mn, mx, (mn + mx) * 0.5

    def one(name):
        return boxes.get(name)

    arm_data = bpy.data.armatures.new("ShieldLiger")
    arm = bpy.data.objects.new("ShieldLigerArmature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    up = Vector((0, 0, 1))
    fwd = Vector((0, 1, 0))

    root = new_bone(arm_data, "root", Vector((0, -0.15, 0.9)), Vector((0, 0.25, 0.95)), None, up)
    pelvis = one("core_pelvis") or seg_box("core")
    abdomen = one("core_abdomen")
    chest = one("core_chest")
    if pelvis:
        p_c = pelvis[2]
    else:
        p_c = Vector((0, -0.4, 1.1))
    if abdomen:
        a_c = abdomen[2]
    else:
        a_c = Vector((0, 0.3, 1.2))
    if chest:
        c_c = chest[2]
    else:
        c_c = Vector((0, 1.1, 1.25))
    spine1 = new_bone(arm_data, "spine1", Vector((p_c.x, p_c.y - 0.15, p_c.z)), Vector((a_c.x, (p_c.y + a_c.y) * 0.5, p_c.z)), root, up)
    spine2 = new_bone(arm_data, "spine2", spine1.tail.copy(), Vector((a_c.x, a_c.y, a_c.z)), spine1, up)
    spine3 = new_bone(arm_data, "spine3", spine2.tail.copy(), Vector((c_c.x, c_c.y, c_c.z)), spine2, up)

    head_box = one("head") or one("head_jaw") or one("head_shieldTop")
    if head_box:
        h = head_box[2]
        h_mn, h_mx = head_box[0], head_box[1]
    else:
        h = Vector((0, 2.1, 1.6))
        h_mn, h_mx = h - Vector((0.2, 0.2, 0.2)), h + Vector((0.2, 0.2, 0.2))
    neck = new_bone(arm_data, "neck", spine3.tail.copy(), Vector((h.x, h.y - 0.25, h.z)), spine3, up)
    head = new_bone(arm_data, "head", neck.tail.copy(), Vector((h.x, h_mx.y, h.z)), neck, up)
    jaw_box = one("head_jaw") or one("head_shieldChin")
    if jaw_box:
        j = jaw_box[2]
        jaw_tail = Vector((j.x, jaw_box[1].y, jaw_box[0].z))
    else:
        j = Vector((h.x, h.y, h.z - 0.25))
        jaw_tail = j + Vector((0, 0.2, -0.15))
    jaw = new_bone(arm_data, "jaw", Vector((j.x, j.y, max(j.z, 0.4))), jaw_tail, head, up)

    # Plate bones sit on the mesh center and point along a world axis, so a
    # 70 degree pitch spins the plate in place instead of orbiting the torso.
    chin = one("head_shieldChin")
    c = chin[2] if chin else Vector((0, 2.2, 1.05))
    new_bone(arm_data, "shieldChin", c, c + Vector((0, 0.22, 0)), head, up)

    top = one("head_shieldTop")
    c = top[2] if top else Vector((0, 1.8, 1.95))
    new_bone(arm_data, "shieldTop", c, c + Vector((0, 0.22, 0)), neck, up)

    for side, sign in (("shieldLeft", -1), ("shieldRight", 1)):
        part = "leftWeapon_shield" if sign < 0 else "rightWeapon_shield"
        box = one(part)
        c = box[2] if box else Vector((sign * 0.9, 0.6, 1.4))
        new_bone(arm_data, side, c, c + Vector((sign * 0.22, 0, 0)), spine3, up)

    panel = one("backMount_panel")
    c = panel[2] if panel else Vector((0, -0.1, 1.7))
    back = new_bone(arm_data, "backPanel", c, c + Vector((0, 0.22, 0)), spine2, up)
    gun = one("backMount_gun")
    c = gun[2] if gun else back.head + Vector((0, 0.05, -0.08))
    new_bone(arm_data, "twinGun", c, c + Vector((0, 0.28, 0)), back, up)

    cannon = one("headWeapon_chest")
    c = cannon[2] if cannon else Vector((0, 1.4, 1.1))
    new_bone(arm_data, "chestCannon", c, c + Vector((0, 0.28, 0)), spine3, up)

    tail_parent = spine1
    prev = tail_parent.tail.copy()
    for i in range(1, 5):
        box = one(f"tail_{i}")
        if box:
            head_p = Vector((box[2].x, box[1].y, box[2].z))
            tail_p = Vector((box[2].x, box[0].y, box[2].z))
        else:
            head_p = prev
            tail_p = prev + Vector((0, -0.35, 0.02))
        bone = new_bone(arm_data, f"tail{i}", head_p, tail_p, tail_parent, up)
        tail_parent = bone
        prev = bone.tail.copy()

    for leg in LEG_NAMES:
        sign = -1 if leg.startswith("left") else 1
        front = "Front" in leg
        upper = one(f"{leg}_upper")
        lower = one(f"{leg}_lower")
        ankle = one(f"{leg}_ankle")
        paw = one(f"{leg}_paw")
        chain = [upper, lower, ankle, paw]
        known = [b for b in chain if b]
        if known:
            cx = sum(b[2].x for b in known) / len(known)
            cy = sum(b[2].y for b in known) / len(known)
        else:
            cx = sign * 0.55
            cy = 1.3 if front else -1.1
        z_hip = upper[1].z if upper else 1.05
        z_knee = lower[1].z if lower else (upper[0].z if upper else 0.7)
        z_ankle = ankle[1].z if ankle else (lower[0].z if lower else 0.35)
        z_paw = paw[0].z if paw else 0.02
        parent = spine3 if front else spine1
        hip = new_bone(arm_data, f"{leg}_hip", Vector((cx, cy, z_hip)), Vector((cx, cy, z_knee)), parent, fwd)
        knee = new_bone(arm_data, f"{leg}_knee", hip.tail.copy(), Vector((cx, cy, z_ankle)), hip, fwd)
        ank = new_bone(arm_data, f"{leg}_ankle", knee.tail.copy(), Vector((cx, cy, max(z_paw + 0.08, z_ankle - 0.12))), knee, fwd)
        new_bone(arm_data, f"{leg}_paw", ank.tail.copy(), Vector((cx, cy + 0.05, z_paw)), ank, fwd)

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def bind(objects, arm):
    for obj in objects:
        bone = obj.get("bone") or "spine2"
        if bone not in arm.data.bones:
            bone = "spine2"
        group = obj.vertex_groups.new(name=bone)
        group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        mod.use_vertex_groups = True
        mod.use_bone_envelopes = False
        obj.parent = arm
        obj.matrix_parent_inverse = arm.matrix_world.inverted()
    for material in bpy.data.materials:
        material.use_backface_culling = False


def ensure_action(arm, name):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    try:
        slots = getattr(action, "slots", None)
        if slots is not None and len(slots) == 0 and hasattr(slots, "new"):
            slots.new("OBJECT", name)
        if slots is not None and len(slots) and hasattr(arm.animation_data, "action_slot"):
            arm.animation_data.action_slot = slots[0]
    except Exception as exc:
        log(f"action slot note: {exc}")
    return action


def pose_mode(arm):
    bpy.context.view_layer.objects.active = arm
    if bpy.context.object.mode != "POSE":
        bpy.ops.object.mode_set(mode="POSE")


def key_euler(arm, bone, frame, rx=0.0, ry=0.0, rz=0.0):
    pb = arm.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = (rx, ry, rz)
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def key_loc(arm, bone, frame, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones[bone]
    pb.location = (x, y, z)
    pb.keyframe_insert(data_path="location", frame=frame)


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def leg_keys(arm, frame, swings, spread=0.0):
    """swings: leg name -> hip pitch in radians. Positive pitches the foot forward."""
    for leg, hip in swings.items():
        sign = -1 if leg.startswith("left") else 1
        knee = -0.85 * hip
        ankle = -0.35 * hip
        paw = -(hip + knee + ankle)
        key_euler(arm, f"{leg}_hip", frame, hip, 0, sign * spread)
        key_euler(arm, f"{leg}_knee", frame, knee, 0, 0)
        key_euler(arm, f"{leg}_ankle", frame, ankle, 0, 0)
        key_euler(arm, f"{leg}_paw", frame, paw, 0, 0)


def body_keys(arm, frame, spine=0.0, yaw=0.0, neck=0.0, head=0.0, tail=0.0, bob=0.0, jaw=0.0):
    key_euler(arm, "root", frame, 0, 0, 0)
    key_loc(arm, "root", frame, 0, 0, bob)
    key_euler(arm, "spine1", frame, spine * 0.45, 0, yaw * 0.4)
    key_euler(arm, "spine2", frame, spine * 0.35, 0, yaw * 0.35)
    key_euler(arm, "spine3", frame, spine * 0.25, 0, yaw * 0.25)
    key_euler(arm, "neck", frame, neck, 0, -yaw * 0.2)
    key_euler(arm, "head", frame, head, 0, -yaw * 0.15)
    key_euler(arm, "jaw", frame, jaw, 0, 0)
    key_euler(arm, "tail1", frame, spine * -0.2, 0, -tail)
    key_euler(arm, "tail2", frame, 0, 0, -tail * 0.7)
    key_euler(arm, "tail3", frame, 0, 0, -tail * 0.45)
    key_euler(arm, "tail4", frame, 0, 0, -tail * 0.25)


def shield_keys(arm, frame, chin=0.0, top=0.0, flare=0.0):
    # Bones point through the plate center. Pitch drops the chin and lifts the
    # crest. Side bones point outward, so a roll swings them off the body.
    key_euler(arm, "shieldChin", frame, -chin, 0, 0)
    key_euler(arm, "shieldTop", frame, top, 0, 0)
    key_euler(arm, "shieldLeft", frame, 0, flare, 0)
    key_euler(arm, "shieldRight", frame, 0, -flare, 0)


def weapon_rest(arm, frame):
    key_euler(arm, "backPanel", frame, 0, 0, 0)
    key_euler(arm, "twinGun", frame, 0, 0, 0)
    key_loc(arm, "twinGun", frame, 0, 0, 0)
    key_euler(arm, "chestCannon", frame, 0, 0, 0)
    key_loc(arm, "chestCannon", frame, 0, 0, 0)


def zero_swings():
    return {leg: 0.0 for leg in LEG_NAMES}


def build_actions(arm):
    import math
    pose_mode(arm)
    actions = {}

    def begin(name):
        action = ensure_action(arm, name)
        actions[name] = action
        return action

    # Idle, 48 frames. Breathing and a slow tail drift. Shield stays stowed.
    begin("Idle")
    for frame in range(0, 49, 4):
        t = frame / 48
        ang = math.sin(t * math.tau)
        body_keys(arm, frame, spine=ang * 0.035, head=math.sin(t * math.tau + 0.6) * 0.03, tail=ang * 0.10, bob=abs(ang) * 0.012)
        leg_keys(arm, frame, zero_swings())
        shield_keys(arm, frame)
        weapon_rest(arm, frame)
    body_keys(arm, 48, spine=0, head=math.sin(0.6) * 0, tail=0, bob=0)
    # frame 48 must match frame 0
    body_keys(arm, 48, spine=0, head=math.sin(0.6) * 0.0, tail=0, bob=0)
    leg_keys(arm, 48, zero_swings())
    shield_keys(arm, 48)
    weapon_rest(arm, 48)
    # rewrite 48 to equal frame 0 exactly
    body_keys(arm, 0, spine=0, head=math.sin(0.6) * 0.03, tail=0, bob=0)
    body_keys(arm, 48, spine=0, head=math.sin(0.6) * 0.03, tail=0, bob=0)

    # Walk, 28 frames. Diagonal pairs: front-left with rear-right.
    begin("Walk")
    for frame in range(0, 29, 2):
        t = frame / 28
        phase = t * math.tau
        lf = math.sin(phase) * 0.48
        rf = math.sin(phase + math.pi) * 0.48
        swings = {
            "leftFrontLeg": lf,
            "rightRearLeg": lf * 0.95,
            "rightFrontLeg": rf,
            "leftRearLeg": rf * 0.95,
        }
        body_keys(
            arm, frame,
            spine=abs(math.sin(phase)) * 0.03,
            yaw=math.sin(phase) * 0.05,
            head=math.sin(phase) * 0.04,
            tail=-math.sin(phase) * 0.22,
            bob=abs(math.sin(phase)) * 0.03,
        )
        leg_keys(arm, frame, swings)
        shield_keys(arm, frame)
        weapon_rest(arm, frame)

    # Run, 20 frames. Bounding gallop: fronts together, rears together, half a cycle apart.
    begin("Run")
    for frame in range(0, 21, 2):
        t = frame / 20
        phase = t * math.tau
        front = math.sin(phase) * 0.72
        rear = math.sin(phase + math.pi) * 0.78
        swings = {
            "leftFrontLeg": front,
            "rightFrontLeg": front,
            "leftRearLeg": rear,
            "rightRearLeg": rear,
        }
        body_keys(
            arm, frame,
            spine=math.sin(phase) * 0.14,
            head=math.sin(phase) * -0.04,
            tail=-math.sin(phase) * 0.16,
            bob=max(0.0, math.sin(phase)) * 0.08,
        )
        leg_keys(arm, frame, swings)
        shield_keys(arm, frame)
        weapon_rest(arm, frame)

    # ShieldActivate, 18 frames, one shot from stowed to deployed.
    begin("ShieldActivate")
    for frame in range(0, 19):
        e = smooth(frame / 18)
        body_keys(arm, frame, spine=-0.06 * e, head=0.10 * e, neck=0.06 * e, bob=-0.02 * e)
        leg_keys(arm, frame, zero_swings(), spread=0.14 * e)
        shield_keys(arm, frame, chin=1.22 * e, top=1.22 * e, flare=0.65 * e)
        weapon_rest(arm, frame)

    # ShieldMaintain, 48 frames. Holds the deployed plates and hums.
    begin("ShieldMaintain")
    for frame in range(0, 49, 2):
        hum = math.sin(frame / 48 * math.tau * 4)
        breath = math.sin(frame / 48 * math.tau)
        body_keys(arm, frame, spine=-0.06 + breath * 0.02, head=0.10, neck=0.06, bob=-0.02)
        leg_keys(arm, frame, zero_swings(), spread=0.14)
        shield_keys(arm, frame, chin=1.22 + hum * 0.035, top=1.22 + hum * 0.03, flare=0.65 + hum * 0.04)
        weapon_rest(arm, frame)

    # Fire, 16 frames. Panel up, guns kick back, body rocks, then returns.
    begin("Fire")
    for frame in range(0, 17):
        t = frame / 16
        env = (t / 0.22) if t < 0.22 else max(0.0, 1 - (t - 0.22) / 0.78)
        body_keys(arm, frame, spine=-0.10 * env, head=0.04 * env)
        leg_keys(arm, frame, zero_swings())
        shield_keys(arm, frame)
        key_euler(arm, "backPanel", frame, -1.15 * env, 0, 0)
        key_euler(arm, "twinGun", frame, 0, 0, 0)
        key_loc(arm, "twinGun", frame, 0, -0.16 * env, 0)
        key_euler(arm, "chestCannon", frame, 0.08 * env, 0, 0)
        key_loc(arm, "chestCannon", frame, 0, -0.12 * env, 0)

    bpy.ops.object.mode_set(mode="OBJECT")
    # Push every action onto the NLA so the glTF exporter's ACTIONS mode keeps them.
    if arm.animation_data is None:
        arm.animation_data_create()
    for name, action in actions.items():
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        track.mute = True
    arm.animation_data.use_nla = False
    for name, action in actions.items():
        curves = 0
        if getattr(action, "fcurves", None):
            curves = len(action.fcurves)
        elif getattr(action, "layers", None):
            curves = len(action.layers)
        log(f"action {name} curves-or-layers {curves}")
    return actions


def look_at(obj, target):
    direction = (target - obj.location).normalized()
    obj.rotation_euler = direction.to_track_quat("-Z", "Z").to_euler()


def render_sheets(arm, actions):
    os.makedirs(SHOTS, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 320
    scene.render.resolution_y = 240
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    try:
        shading.background_type = "WORLD"
    except Exception:
        pass
    world = bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.color = (0.62, 0.70, 0.78)
    if world.use_nodes and "Background" in world.node_tree.nodes:
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.70, 0.78, 1)
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 42
    cam_data.clip_end = 200
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = Vector((6.2, 3.4, 1.8))
    look_at(cam, Vector((0, 0.15, 0.95)))
    scene.camera = cam
    arm.hide_render = True
    arm.data.display_type = "STICK"

    specs = [
        ("Idle", 48, "idle.png"),
        ("Walk", 28, "walk.png"),
        ("Run", 20, "run.png"),
        ("ShieldActivate", 18, "shield-activate.png"),
        ("ShieldMaintain", 48, "shield-maintain.png"),
        ("Fire", 16, "fire.png"),
    ]
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.use_nla = False
    for name, length, filename in specs:
        action = actions[name]
        arm.animation_data.action = action
        if hasattr(arm.animation_data, "action_slot") and getattr(action, "slots", None) and len(action.slots):
            try:
                arm.animation_data.action_slot = action.slots[0]
            except Exception:
                pass
        frames = [int(round(i * length / 7)) for i in range(8)]
        paths = []
        for index, frame in enumerate(frames):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            path = os.path.join("/tmp", f"sl-{name}-{index}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            paths.append(path)
        stitch(paths, os.path.join(SHOTS, filename))
        log(f"sheet {filename}")
    # Remove the camera so it is not exported.
    bpy.data.objects.remove(cam, do_unlink=True)


def stitch(paths, out_path):
    images = [bpy.data.images.load(path) for path in paths]
    width, height = images[0].size
    count = len(images)
    sheet = bpy.data.images.new("sheet", width=width * count, height=height, alpha=True)
    pixels = [0.0] * (width * count * height * 4)
    for index, image in enumerate(images):
        src = list(image.pixels)
        for y in range(height):
            row = y * width * 4
            dest_row = y * width * count * 4 + index * width * 4
            pixels[dest_row:dest_row + width * 4] = src[row:row + width * 4]
    sheet.pixels.foreach_set(pixels)
    sheet.filepath_raw = out_path
    sheet.file_format = "PNG"
    sheet.save()
    for image in images:
        bpy.data.images.remove(image)
    bpy.data.images.remove(sheet)


def export_glb(arm):
    # Unmute NLA tracks so ACTIONS mode picks every clip up.
    if arm.animation_data:
        for track in arm.animation_data.nla_tracks:
            track.mute = False
        arm.animation_data.use_nla = True
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = 48
    scene.render.fps = FPS
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=RAW,
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_skins=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_force_sampling=True,
        export_optimize_animation_size=True,
        export_rest_position_armature=False,
        export_anim_single_armature=True,
    )
    log(f"exported {RAW}")


def compress():
    script = os.path.join(ROOT, "tools", "compress_shield_anim.mjs")
    subprocess.check_call(["node", script, RAW, OUT], cwd=ROOT)


def main():
    clear_scene()
    bpy.context.scene.render.fps = FPS
    joined = import_and_join()
    mn, mx = orient_and_scale(joined)
    decimate(joined, 70000)
    mn, mx = mesh_bounds(joined)
    box = bounds_of(mn, mx)
    groups = assign_faces(joined, box)
    objects = extract_objects(joined, groups)
    arm = build_armature(objects)
    bind(objects, arm)
    actions = build_actions(arm)
    try:
        render_sheets(arm, actions)
    except Exception:
        traceback.print_exc()
        log("render failed, continuing to export")
    export_glb(arm)
    compress()
    log(f"wrote {OUT}")


if __name__ == "__main__":
    main()
