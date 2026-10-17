"""Build the base body GLB (with morph targets) and its calibration from MakeHuman CC0 assets.

Usage (from the repo root):
    pnpm --filter @aurora/body3d build:body  (MAKEHUMAN_DATA, optional MAKEHUMAN_ASSETS for hair)

Writes:
    assets/models/body.raw.glb      (then compressed by the build:body script)
    assets/models/hair/*.raw.glb    (hair presets, when MAKEHUMAN_ASSETS is set)
    src/calibration.json            (how each morph changes the body's measurements)
    services/body-fit/data/body.npz           (mesh + morphs for the fitting service)

The MakeHuman base mesh and targets are CC0 (see LICENSE.ASSETS.md in the MakeHuman repo).
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

# The single measuring definition lives in the body-fit service.
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services" / "body-fit"))
from body_fit.measure import JOINTS, joint_positions, measure  # noqa: E402

F = NDArray[np.float64]
SCALE = 0.1  # MakeHuman units are decimetres

RACES = ("african", "asian", "caucasian")
# Muscle (lean <-> muscular) at average weight, per body type.
MUSCLE = ("minmuscle", "maxmuscle")
MEASURE = {
    # morph name -> MakeHuman measure target stem
    "chest": "measure-bust-circ",
    "waist": "measure-waist-circ",
    "hips": "measure-hips-circ",
    "shoulders": "measure-shoulder-dist",
    "upperLeg": "measure-upperleg-height",
    "lowerLeg": "measure-lowerleg-height",
    "neck": "measure-neck-circ",
    "thigh": "measure-thigh-circ",
    "upperArm": "measure-upperarm-circ",
}
# Extra shape pairs that are not measurements (morph name -> target file, relative to targets/).
EXTRA = {
    "belly-incr": "stomach/stomach-tone-decr",  # less tone = more belly
    "belly-decr": "stomach/stomach-tone-incr",
}


# --- input --------------------------------------------------------------------------------


def load_obj(path: Path) -> tuple[F, F, list[tuple[str, list[tuple[int, int]]]]]:
    verts: list[list[float]] = []
    uvs: list[list[float]] = []
    faces: list[tuple[str, list[tuple[int, int]]]] = []
    group = ""
    for line in path.read_text().splitlines():
        if line.startswith("v "):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            uvs.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("g "):
            group = line.split(maxsplit=1)[1].strip()
        elif line.startswith("f "):
            corners = []
            for token in line.split()[1:]:
                parts = token.split("/")
                corners.append((int(parts[0]) - 1, int(parts[1]) - 1))
            faces.append((group, corners))
    return np.array(verts), np.array(uvs), faces


def load_target(path: Path, n: int) -> F:
    delta = np.zeros((n, 3))
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        idx, dx, dy, dz = line.split()
        delta[int(idx)] = (float(dx), float(dy), float(dz))
    return delta


def group_center(verts: F, faces: list[tuple[str, list[tuple[int, int]]]], name: str) -> NDArray[np.int64]:
    return np.unique([v for g, corners in faces if g == name for v, _ in corners])


# --- output -------------------------------------------------------------------------------


def vertex_normals(pos: F, tris: NDArray[np.int64]) -> F:
    normals = np.zeros_like(pos)
    face = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    for k in range(3):
        np.add.at(normals, tris[:, k], face)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length == 0, 1, length)


def lip_line(pos: F, faces: list[tuple[str, list[tuple[int, int]]]]) -> NDArray[np.int64]:
    """Vertices whose mean is where the lips meet: the bottom of the upper teeth and the top of
    the lower teeth, near the middle. (The body mesh is closed at the mouth.)"""
    upper = group_center(pos, faces, "helper-upper-teeth")
    lower = group_center(pos, faces, "helper-lower-teeth")
    front = lambda ids: ids[np.abs(pos[ids, 0]) < 0.01]  # noqa: E731
    upper, lower = front(upper), front(lower)
    return np.concatenate([upper[np.argsort(pos[upper, 1])[:4]], lower[np.argsort(-pos[lower, 1])[:4]]])


def gltf_uv(uvs: F) -> F:
    """OBJ texture coordinates start at the bottom left, glTF ones at the top left."""
    return np.stack([uvs[:, 0], 1 - uvs[:, 1]], axis=1)


def write_glb(path: Path, positions: F, normals: F, uvs: F, indices: NDArray[np.int64],
              morphs: list[tuple[str, F, F]], name: str = "Body", texture_png: bytes | None = None) -> None:
    blobs: list[bytes] = []
    views: list[dict[str, int]] = []
    accessors: list[dict[str, object]] = []

    def add(array: NDArray[np.generic], kind: str, component: int, target: int | None, bounds: bool = False) -> int:
        data = array.tobytes()
        offset = sum(len(b) for b in blobs)
        blobs.append(data + b"\x00" * (-len(data) % 4))
        view: dict[str, int] = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        views.append(view)
        accessor: dict[str, object] = {
            "bufferView": len(views) - 1, "componentType": component, "count": len(array), "type": kind,
        }
        if bounds:
            accessor["min"] = array.min(axis=0).tolist()
            accessor["max"] = array.max(axis=0).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    f32 = lambda a: np.ascontiguousarray(a, dtype=np.float32)  # noqa: E731
    attrs = {
        "POSITION": add(f32(positions), "VEC3", 5126, 34962, bounds=True),
        "NORMAL": add(f32(normals), "VEC3", 5126, 34962),
        "TEXCOORD_0": add(f32(gltf_uv(uvs)), "VEC2", 5126, 34962),
    }
    idx = add(np.ascontiguousarray(indices.reshape(-1), dtype=np.uint32), "SCALAR", 5125, 34963)
    targets = [
        {"POSITION": add(f32(dp), "VEC3", 5126, None, bounds=True), "NORMAL": add(f32(dn), "VEC3", 5126, None)}
        for _, dp, dn in morphs
    ]
    extra: dict[str, object] = {}
    if texture_png is not None:
        offset = sum(len(b) for b in blobs)
        blobs.append(texture_png + b"\x00" * (-len(texture_png) % 4))
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(texture_png)})
        extra = {
            "images": [{"bufferView": len(views) - 1, "mimeType": "image/png"}],
            "samplers": [{"magFilter": 9729, "minFilter": 9987}],
            "textures": [{"source": 0, "sampler": 0}],
        }
    gltf = {
        "asset": {"version": "2.0", "generator": "trialandfit build_body.py (MakeHuman CC0 assets)"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "materials": [
            {
                "name": "Hair",
                "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.7},
                "alphaMode": "MASK",
                "alphaCutoff": 0.4,
                "doubleSided": True,
            }
            if texture_png is not None
            else {
                "name": "Skin",
                "pbrMetallicRoughness": {"baseColorFactor": [0.80, 0.62, 0.52, 1], "metallicFactor": 0, "roughnessFactor": 0.6},
            }
        ],
        "meshes": [{
            "name": name,
            "primitives": [{"attributes": attrs, "indices": idx, "material": 0, "targets": targets}],
            "weights": [0.0] * len(morphs),
            "extras": {"targetNames": [name for name, _, _ in morphs]},
        }],
        "buffers": [{"byteLength": sum(len(b) for b in blobs)}],
        "bufferViews": views,
        "accessors": accessors,
        **extra,
    }
    body = b"".join(blobs)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(body)
    with path.open("wb") as out:
        out.write(struct.pack("<III", 0x46546C67, 2, total))
        out.write(struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes)
        out.write(struct.pack("<II", len(body), 0x004E4942) + body)


HAIR_STYLES = {"short": "short02", "bob": "bob01", "long": "long01", "ponytail": "ponytail01"}


def load_mhclo(path: Path) -> tuple[list[list[int]], list[list[float]], list[list[float]], dict[str, tuple[int, int, float]]]:
    """Proxy binding: per proxy vertex, base vertex indices, weights and scaled offsets."""
    refs: list[list[int]] = []
    weights: list[list[float]] = []
    offsets: list[list[float]] = []
    scales: dict[str, tuple[int, int, float]] = {}
    in_verts = False
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        if parts[0] in ("x_scale", "y_scale", "z_scale"):
            scales[parts[0][0]] = (int(parts[1]), int(parts[2]), float(parts[3]))
        elif parts[0] == "verts":
            in_verts = True
        elif parts[0] == "delete_verts":  # clothes: the body vertices they cover (not bindings)
            in_verts = False
        elif in_verts and parts[0].isdigit():
            if len(parts) == 1:
                refs.append([int(parts[0])] * 3)
                weights.append([1.0, 0.0, 0.0])
                offsets.append([0.0, 0.0, 0.0])
            else:
                refs.append([int(p) for p in parts[:3]])
                weights.append([float(p) for p in parts[3:6]])
                offsets.append([float(p) for p in parts[6:9]])
        # Other lines (e.g. a stray "material" after "verts 0" in bob01) don't end the section.
    return refs, weights, offsets, scales


def proxy_positions(base: F, refs: NDArray[np.int64], weights: F, offsets: F,
                    scales: dict[str, tuple[int, int, float]]) -> F:
    pos = np.einsum("pk,pkc->pc", weights, base[refs])
    factor = np.array([abs(base[i, axis] - base[j, axis]) / ref
                       for axis, (i, j, ref) in ((0, scales["x"]), (1, scales["y"]), (2, scales["z"]))])
    return pos + offsets * factor


def build_hair(style_dir: Path, base_dm: F, deltas_dm: dict[str, F], shift: F, out: Path) -> None:
    """Hair GLB whose morph targets follow the body's (via the mhclo binding)."""
    from PIL import Image  # only needed when building hair

    name = style_dir.name
    _, hair_uvs, hair_faces = load_obj(style_dir / f"{name}.obj")
    refs_l, w_l, off_l, scales = load_mhclo(style_dir / f"{name}.mhclo")
    refs, weights, offsets = np.array(refs_l, dtype=np.int64), np.array(w_l), np.array(off_l)
    neutral = proxy_positions(base_dm, refs, weights, offsets, scales)
    keys: dict[tuple[int, int], int] = {}
    rows: list[list[int]] = []
    for _, corners in hair_faces:
        ids = [keys.setdefault(c, len(keys)) for c in corners]
        rows += [[ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1)]
    order = sorted(keys, key=keys.__getitem__)
    src = np.array([v for v, _ in order])
    uvs = hair_uvs[np.array([t for _, t in order])]
    tris = np.array(rows)
    orig_tris = src[tris]
    positions = neutral * SCALE
    base_normals = vertex_normals(positions, orig_tris)
    morphs = []
    for morph_name, d in deltas_dm.items():
        moved = proxy_positions(base_dm + d, refs, weights, offsets, scales) * SCALE
        morphs.append((morph_name, (moved - positions)[src], (vertex_normals(moved, orig_tris) - base_normals)[src]))
    image = Image.open(style_dir / f"{name}_diffuse.png").convert("RGBA")
    image.thumbnail((1024, 1024))
    # Neutral grey strands (same light/dark detail, average ~75% white) so the viewer can tint
    # the hair any colour, including light ones, by multiplying.
    rgba = np.asarray(image).astype(np.float64)
    luma = rgba[..., :3] @ [0.299, 0.587, 0.114]
    visible = rgba[..., 3] > 100
    # Square root of the brightness ratio: keeps strand detail but evens out dark tips/roots.
    ratio = luma / max(float(luma[visible].mean()), 1.0)
    grey = np.clip(190 * np.sqrt(ratio), 0, 255)
    rgba[..., :3] = grey[..., None]
    image = Image.fromarray(rgba.round().astype(np.uint8), "RGBA")
    import io
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    write_glb(out, (positions + shift)[src], base_normals[src], uvs, tris, morphs, name="Hair", texture_png=buffer.getvalue())


def load_deltas(data: Path, n: int) -> dict[str, F]:
    """The body's morph targets on the base mesh's vertices (MakeHuman decimetres)."""
    ethnic = {
        g: np.mean([load_target(data / "targets" / "macrodetails" / f"{r}-{g}-young.target", n) for r in RACES], axis=0)
        for g in ("female", "male")
    }
    deltas: dict[str, F] = {"female": ethnic["female"], "male": ethnic["male"]}
    for g in ("female", "male"):
        for w in ("minweight", "maxweight"):
            deltas[f"{g}-{w}"] = load_target(
                data / "targets" / "macrodetails" / f"universal-{g}-young-averagemuscle-{w}.target", n
            )
        for m in MUSCLE:
            deltas[f"{g}-{m}"] = load_target(
                data / "targets" / "macrodetails" / f"universal-{g}-young-{m}-averageweight.target", n
            )
    for name, stem in MEASURE.items():
        for direction in ("incr", "decr"):
            deltas[f"{name}-{direction}"] = load_target(data / "targets" / "measure" / f"{stem}-{direction}.target", n)
    for name, rel in EXTRA.items():
        deltas[name] = load_target(data / "targets" / f"{rel}.target", n)
    return deltas


def main() -> None:
    data, out = Path(sys.argv[1]), Path(sys.argv[2])
    raw, raw_uvs, faces = load_obj(data / "3dobjs" / "base.obj")
    n = len(raw)
    joint_idx = {name: group_center(raw, faces, f"joint-{name}") for name in JOINTS}

    def joints_of(p: F) -> dict[str, F]:
        return joint_positions(p, joint_idx)

    # Body surface only, triangulated, with vertices split at UV seams.
    corners_list = [c for g, c in faces if g == "body"]
    keys: dict[tuple[int, int], int] = {}
    tri_rows: list[list[int]] = []
    for corners in corners_list:
        ids = [keys.setdefault(c, len(keys)) for c in corners]
        tri_rows += [[ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1)]
    order = sorted(keys, key=keys.__getitem__)
    src = np.array([v for v, _ in order])  # original vertex index for each output vertex
    uvs = raw_uvs[np.array([t for _, t in order])]
    tris = np.array(tri_rows)
    # Triangles on original indices (no seam splits) for normals and measuring.
    orig_tris = src[tris]

    def to_m(p: F) -> F:
        return p * SCALE

    # Morph deltas on the original vertex set (metres).
    deltas_dm = load_deltas(data, n)
    deltas = {k: to_m(v) for k, v in deltas_dm.items()}

    base = to_m(raw)
    # Calibrate around the androgynous midpoint (half female, half male), where the slider starts.
    neutral = base + 0.5 * deltas["female"] + 0.5 * deltas["male"]
    floor = float(neutral[src][:, 1].min())
    shift = np.array([0.0, -floor, 0.0])
    neutral_m = measure(neutral[src], tris, joints_of(neutral))
    effects: dict[str, dict[str, float]] = {}
    for name, d in deltas.items():
        changed = measure((neutral + d)[src], tris, joints_of(neutral + d))
        effects[name] = {k: round(changed[k] - neutral_m[k], 5) for k in neutral_m}
        print(f"{name:16} " + " ".join(f"{k}={v * 100:+.1f}cm" for k, v in effects[name].items()))

    eyes = {side: (joints_of(base)[f"{side}-eye"] + shift).round(5).tolist() for side in ("l", "r")}
    eye_deltas = {name: {side: joints_of(base + d)[f"{side}-eye"] - joints_of(base)[f"{side}-eye"] for side in ("l", "r")} for name, d in deltas.items()}
    calibration = {
        "source": "MakeHuman hm08 base mesh and targets (CC0)",
        "units": "metres; effects are the change in each measurement at morph weight 1",
        "neutral": {"weights": {"female": 0.5, "male": 0.5}, **{k: round(v, 5) for k, v in neutral_m.items()}},
        "effects": effects,
        "eyes": {"base": eyes, "deltas": {k: {s: v.round(5).tolist() for s, v in e.items()} for k, e in eye_deltas.items()}},
    }

    positions = base[src] + shift
    base_normals_orig = vertex_normals(base, orig_tris)
    morphs = []
    for name, d in deltas.items():
        moved_normals = vertex_normals(base + d, orig_tris)
        morphs.append((name, d[src], (moved_normals - base_normals_orig)[src]))
    normals = base_normals_orig[src]  # smooth across UV seams

    (out / "assets" / "models").mkdir(parents=True, exist_ok=True)
    write_glb(out / "assets" / "models" / "body.raw.glb", positions, normals, uvs, tris, morphs)
    (out / "src" / "calibration.json").write_text(json.dumps(calibration, indent=2) + "\n")

    # Where the lips meet (the "mouth" joint sits inside the jaw). Lines the face up with a photo.
    joint_idx["lips"] = lip_line(base, faces)

    # Fitting data for the service: original topology (no UV seams), body + joint vertices only.
    keep = np.unique(np.concatenate([src, *joint_idx.values()]))
    remap = -np.ones(n, dtype=np.int64)
    remap[keep] = np.arange(len(keep))
    service_data = Path(__file__).resolve().parents[3] / "services" / "body-fit" / "data" / "body.npz"
    np.savez_compressed(
        service_data,
        base=(base[keep] + shift).astype(np.float32),
        tris=remap[orig_tris].astype(np.int32),
        # Texture coordinates per triangle corner (for baking the face into the body texture).
        uvs=gltf_uv(raw_uvs).astype(np.float32),
        tri_uvs=np.array([t for _, t in order])[tris].astype(np.int32),
        names=np.array(list(deltas)),
        deltas=np.stack([d[keep] for d in deltas.values()]).astype(np.float32),
        **{f"joint_{k}": remap[v].astype(np.int32) for k, v in joint_idx.items()},
    )
    print(f"service data: {service_data.stat().st_size / 1e6:.1f} MB")

    if len(sys.argv) > 3:  # MakeHuman system assets dir (CC0): hair
        hair_dir = out / "assets" / "models" / "hair"
        hair_dir.mkdir(parents=True, exist_ok=True)
        for style, folder in HAIR_STYLES.items():
            build_hair(Path(sys.argv[3]) / "hair" / folder, raw, deltas_dm, shift, hair_dir / f"{style}.raw.glb")
            print(f"hair: {style} ({folder})")
    print(f"vertices={len(positions)} triangles={len(tris)} morphs={len(morphs)} neutral height={neutral_m['height']:.3f} m")


if __name__ == "__main__":
    main()
