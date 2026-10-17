"""Build the garment templates (GLB with the body's morph targets) from MakeHuman CC0 clothes.

Usage (from the repo root):
    MAKEHUMAN_DATA=... MAKEHUMAN_ASSETS=... pnpm --filter @aurora/body3d build:clothes

MAKEHUMAN_DATA is makehuman/data from the MakeHuman repo (base mesh and targets);
MAKEHUMAN_ASSETS is the extracted CC0 system assets pack (the folder that contains clothes/).

Writes:
    assets/models/clothes/<style>.raw.glb   (then compressed by the build:clothes script)
    src/clothes.json                        (per style: source garment, body points it covers)

Like the hair, each garment is a MakeHuman proxy bound to the base mesh (.mhclo), so it gets
the same morph targets as the body and follows its shape. "hidden" lists where the body points
the garment covers are (from the .mhclo delete_verts; x, y, z in whole millimetres on the
neutral base body), so the viewer can hide skin under it. Positions, not vertex numbers:
compressing body.glb reorders its vertices.
"""

import json
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_body import (
    SCALE,
    F,
    load_deltas,
    load_mhclo,
    load_obj,
    proxy_positions,
    vertex_normals,
    write_glb,
)

# Garment style -> (MakeHuman system clothes "suit", the part of it to keep). Each suit is a
# top and a bottom as separate pieces in one mesh.
CLOTHES = {
    "tee": ("male_casualsuit06", "top"),  # plain white T-shirt
    "longSleeve": ("male_casualsuit02", "top"),
    "trousers": ("male_casualsuit04", "bottom"),  # jeans
    "shorts": ("female_casualsuit02", "bottom"),  # denim shorts
    "skirt": ("female_elegantsuit01", "bottom"),
}


def body_layout(faces: list[tuple[str, list[tuple[int, int]]]]) -> NDArray[np.int64]:
    """For each body.glb vertex, its base mesh vertex (same order as build_body.py)."""
    keys: dict[tuple[int, int], int] = {}
    for group, corners in faces:
        if group == "body":
            for c in corners:
                keys.setdefault(c, len(keys))
    return np.array([v for v, _ in sorted(keys, key=keys.__getitem__)])


def load_delete_verts(path: Path) -> set[int]:
    """Base mesh vertices the garment covers ("delete_verts": numbers and "a - b" ranges)."""
    deleted: set[int] = set()
    lines = iter(path.read_text().splitlines())
    for line in lines:
        if line.strip() == "delete_verts":
            for row in lines:
                tokens = row.split()
                if not tokens or not (tokens[0].isdigit()):
                    break
                i = 0
                while i < len(tokens):
                    if i + 2 < len(tokens) and tokens[i + 1] == "-":
                        deleted.update(range(int(tokens[i]), int(tokens[i + 2]) + 1))
                        i += 3
                    else:
                        deleted.add(int(tokens[i]))
                        i += 1
    return deleted


def split_parts(
    n: int, faces: list[tuple[str, list[tuple[int, int]]]], heights: F
) -> NDArray[np.bool_]:
    """Per vertex: True for the top piece (the connected piece reaching highest), False for
    the rest of the suit (trousers, shorts or skirt, and anything attached like a belt)."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    edges = np.array([(c[i][0], c[(i + 1) % len(c)][0]) for _, c in faces for i in range(len(c))])
    graph = coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    return np.asarray(labels == labels[int(np.argmax(heights))])


def build_garment(
    folder: Path, part: str, base_dm: F, deltas_dm: dict[str, F], shift: F, out: Path
) -> tuple[float, float]:
    """Writes the GLB; returns the kept piece's height range (metres, on the floor-shifted body)."""
    name = folder.name
    obj = next(folder.glob("*.obj"))
    _, uvs_all, faces = load_obj(obj)
    refs_l, w_l, off_l, scales = load_mhclo(next(folder.glob("*.mhclo")))
    refs, weights, offsets = np.array(refs_l, dtype=np.int64), np.array(w_l), np.array(off_l)
    neutral = proxy_positions(base_dm, refs, weights, offsets, scales)

    top = split_parts(len(neutral), faces, neutral[:, 1])
    faces = [(g, c) for g, c in faces if bool(top[c[0][0]]) == (part == "top")]

    keys: dict[tuple[int, int], int] = {}
    rows: list[list[int]] = []
    for _, corners in faces:
        ids = [keys.setdefault(c, len(keys)) for c in corners]
        rows += [[ids[0], ids[i], ids[i + 1]] for i in range(1, len(ids) - 1)]
    order = sorted(keys, key=keys.__getitem__)
    src = np.array([v for v, _ in order])
    uvs = uvs_all[np.array([t for _, t in order])]
    tris = np.array(rows)
    orig_tris = src[tris]
    positions = neutral * SCALE
    normals = vertex_normals(positions, orig_tris)
    morphs = []
    for morph_name, d in deltas_dm.items():
        moved = proxy_positions(base_dm + d, refs, weights, offsets, scales) * SCALE
        morphs.append(
            (
                morph_name,
                (moved - positions)[src],
                (vertex_normals(moved, orig_tris) - normals)[src],
            )
        )
    write_glb(out, (positions + shift)[src], normals[src], uvs, tris, morphs, name="Garment")
    print(f"{out.name}: {name} ({part}), {len(src)} vertices, {len(tris)} triangles")
    heights = (positions + shift)[src][:, 1]
    return float(heights.min()), float(heights.max())


def main() -> None:
    data, assets, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    raw, _, faces = load_obj(data / "3dobjs" / "base.obj")
    n = len(raw)
    deltas_dm = load_deltas(data, n)
    src = body_layout(faces)
    neutral = (raw + 0.5 * deltas_dm["female"] + 0.5 * deltas_dm["male"]) * SCALE
    shift = np.array([0.0, -float(neutral[src][:, 1].min()), 0.0])
    # The base mesh must line up with the body the website draws (same MakeHuman data).
    service = np.load(
        Path(__file__).resolve().parents[3] / "services" / "body-fit" / "data" / "body.npz"
    )
    ours = (raw * SCALE + shift)[src]
    for a, b in ((ours.min(0), service["base"].min(0)), (ours.max(0), service["base"].max(0))):
        if not np.allclose(a, b, atol=1e-4):
            raise SystemExit(f"MakeHuman data doesn't match body.glb: {a} vs {b}")

    clothes_dir = out / "assets" / "models" / "clothes"
    clothes_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, object]] = {}
    for style, (folder_name, part) in CLOTHES.items():
        folder = assets / "clothes" / folder_name
        low, high = build_garment(
            folder, part, raw, deltas_dm, shift, clothes_dir / f"{style}.raw.glb"
        )
        # The suit's delete_verts cover both pieces: keep the body under this piece's heights.
        deleted = load_delete_verts(next(folder.glob("*.mhclo")))
        covered = np.nonzero(np.isin(src, list(deleted)))[0]
        y = ours[covered, 1]
        covered = covered[(y >= low) & (y <= high)]
        points = np.unique(np.round(ours[covered] * 1000).astype(np.int64), axis=0)
        manifest[style] = {"source": f"{folder_name} ({part})", "hidden": points.reshape(-1).tolist()}
    (out / "src" / "clothes.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
