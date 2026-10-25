// Sketchfab sources baked into assets/models. CC-BY-4.0.
// Changes on every file: scaled/split/optimized/stripped helper nodes.

export const LICENSE_NAME = "CC-BY-4.0";
export const LICENSE_URL = "http://creativecommons.org/licenses/by/4.0/";

export const MODEL_CREDITS = [
  {
    slug: "blade-liger",
    title: "Zoids Blade Liger",
    author: "guntuy3",
    authorUrl: "https://sketchfab.com/guntuy3",
    modelUrl: "https://sketchfab.com/3d-models/zoids-blade-liger-d4caf50b3c934b2ba29fd2f25d730f28",
    changes: "scaled/split/optimized/stripped helper nodes",
  },
  {
    slug: "shield-liger",
    title: "Shield Liger WIP",
    author: "hdbanks1",
    authorUrl: "https://sketchfab.com/hdbanks1",
    modelUrl: "https://sketchfab.com/3d-models/shield-liger-wip-c903bfa399194201a0cb649311ec308f",
    changes: "scaled/split/optimized/stripped helper nodes; rigged with armature, split into segments, animated",
  },
  {
    slug: "geno-saurer",
    title: "Genosaurer Zoids (free)",
    author: "Anderson455",
    authorUrl: "https://sketchfab.com/pablo.gabriel87",
    modelUrl: "https://sketchfab.com/3d-models/genosaurer-zoids-free-3b7075f3b14a4022ad3996e0eda8ca88",
    changes: "scaled/split/optimized/stripped helper nodes",
  },
  {
    slug: "command-wolf",
    title: "Command Wolf",
    author: "Warner's Digital Art",
    authorUrl: "https://sketchfab.com/warnerdraws",
    modelUrl: "https://sketchfab.com/3d-models/command-wolf-a69dcd74f065467981aaf3d9dc913b59",
    changes: "scaled/split/optimized/stripped helper nodes",
  },
  {
    slug: "iron-kong",
    title: "Iron Kong - Zoids",
    author: "Anderson123",
    authorUrl: "https://sketchfab.com/Mr_Anderson123",
    modelUrl: "https://sketchfab.com/3d-models/iron-kong-zoids-74a45b6ead5f4f21bc6df68c9ca9bd9a",
    changes: "scaled/split/optimized/stripped helper nodes",
  },
  {
    slug: "death-saurer",
    title: "Death saurer Zoids (free)",
    author: "Anderson455 (now Anderson123)",
    authorUrl: "https://sketchfab.com/Mr_Anderson123",
    modelUrl: "https://sketchfab.com/3d-models/death-saurer-zoids-free-57539bc35b2445e997c091cccbdbee8b",
    changes: "scaled/split/optimized/stripped helper nodes; rotated upright and turned to face forward",
  },
  {
    slug: "death-stinger",
    title: "Death Stinger Zoids (free)",
    author: "Anderson455 (now Anderson123)",
    authorUrl: "https://sketchfab.com/Mr_Anderson123",
    modelUrl: "https://sketchfab.com/3d-models/death-stinger-zoids-free-26c18f813ea741b691b8d5e421b3ded5",
    changes: "scaled/split/optimized/stripped helper nodes; rotated upright and turned to face forward",
  },
];

export function creditsMarkup() {
  const blocks = MODEL_CREDITS.map((row) => `
    <article>
      <h3>${row.title}</h3>
      <p>Author: <a href="${row.authorUrl}" target="_blank" rel="noreferrer">${row.author}</a></p>
      <p>Model: <a href="${row.modelUrl}" target="_blank" rel="noreferrer">${row.modelUrl}</a></p>
      <p>License: <a href="${LICENSE_URL}" target="_blank" rel="noreferrer">${LICENSE_NAME}</a></p>
      <p>Changes: ${row.changes}</p>
    </article>
  `).join("");
  return `
    <div class="credits-sheet">
      <header>
        <h2>Model credits</h2>
        <button type="button" data-act="close-credits">Close</button>
      </header>
      <p>Seven Zoids use meshes from Sketchfab under ${LICENSE_NAME}. Gojulas stays a procedural mock. Gun Sniper uses a model supplied by Daniel Williams (25 Oct 2026; licence not stated). Zaber Fang (supplied by Daniel Williams, licence not stated) uses his zaber_fang.glb from 25 Oct 2026. Elephander, Berserk Fuhrer, Molga, and Pteras are original procedural models made for this project. Add <code>?mock=1</code> to the page address to force every Zoid back to the mock.</p>
      ${blocks}
    </div>
  `;
}
