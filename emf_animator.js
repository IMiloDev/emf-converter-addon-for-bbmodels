let ABOUT_TEXT = `
EMF Converter Addon

Converts Blockbench animations into EMF mathematical expressions.

Supports:
- idle (age-based)
- walk (limb_swing)
- custom variables

Export via: File → Export animation as .jem
Made by IMilo
`;

fetch("https://raw.githubusercontent.com/IMiloDev/emf-converter-addon-for-bbmodels/main/assets/About.txt")
  .then(r => r.text())
  .then(text => {
    ABOUT_TEXT = text;
  })
  .catch(() => {
    console.warn("Failed to load remote about.txt, using fallback.");
  });

Plugin.register("emf_animator", {
  title: "EMF Converter Addon",
  author: "Milo (IMiloDev)",
  description: "Converts keyframe animations to mathematical expressions for EMF (Entity Model Features). Made by Treben.",
  version: "0.1.4",
  variant: "desktop",

  about: ABOUT_TEXT,

  onload() {

    const accionExportar = new Action("emf_exportar", {
      name: "Export animation as a .jem",
      icon: "output",
      click() {
        exportarAnimaciones();
      }
    });

    MenuBar.addAction(accionExportar, "file");
  },

  onunload() {
    MenuBar.removeAction("file.emf_exportar");
  }
});
// -----------------------------------
// CONSTANTS
// -----------------------------------
const N_HARMONICS = 2;  // If it throws serious errors, try changing the harmonics to 3.
const SUFIJOS_CANAL = {
  rotation: ["rx", "ry", "rz"],
  position: ["tx", "ty", "tz"],
  scale:    ["sx", "sy", "sz"],
};

// There are the bones names from .jem player file. So, it OBLIGATORY to make have this names (The order doesn't matter).
const HUESOS_OFICIALES = {
  head:         "head",
  headwear:     "headwear",
  body:         "body",
  jacket:       "jacket",
  right_arm:    "right_arm",
  left_arm:     "left_arm",
  right_sleeve: "right_sleeve",
  left_sleeve:  "left_sleeve",
  right_leg:    "right_leg",
  left_leg:     "left_leg",
  right_pants:  "right_pants",
  left_pants:   "left_pants",
  //OPTIONAL
  ear:          "ear", 
};

const PACK_FORMATS = {
  "1.20":    { tipo: "simple", formato: 15 },
  "1.20.1":  { tipo: "simple", formato: 15 },
  "1.20.2":  { tipo: "simple", formato: 18 },
  "1.20.4":  { tipo: "simple", formato: 22 },
  "1.20.6":  { tipo: "simple", formato: 32 },
  "1.21":    { tipo: "simple", formato: 34 },
  "1.21.1":  { tipo: "simple", formato: 34 },
  "1.21.2":  { tipo: "simple", formato: 42 },
  "1.21.4":  { tipo: "simple", formato: 46 },
  "1.21.5":  { tipo: "simple", formato: 55 },
  "1.21.6":  { tipo: "simple", formato: 63 },
  "1.21.7":  { tipo: "simple", formato: 64 },
  "1.21.8":  { tipo: "simple", formato: 64 },
  "1.21.9":  { tipo: "rango",  formato: 69 },
  "1.21.10": { tipo: "rango",  formato: 69 },
  "1.21.11": { tipo: "rango",  formato: 75 },
  "26.1":    { tipo: "rango",  formato: 84 },
  "26.2":    { tipo: "rango",  formato: 84 },  // For EXPERIMENTAL
};


function obtenerHuesos() {
  return Group.all.reduce((acum, grupo) => {
    acum[grupo.uuid] = grupo.name;
    return acum;
  }, {}); 
}

function listarAnimaciones() {
  return Object.values(Animator.animations);
}


// ---------------
// TO EXTRACT KEYFRAMES
// ---------------

function valorNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = parseFloat(valor);
  // isNaN = "is Not a Number", equivalente a comprobar si parseFloat falló
  return isNaN(n) ? 0 : n;
}

function extraerKeyframes(animacion, uuidToName) {

  const resultado = {};

  for (const [uuid, animador] of Object.entries(animacion.animators)) {
    
    const nombreHueso = uuidToName[uuid];
    if (!nombreHueso) continue;  

    if (!resultado[nombreHueso]) resultado[nombreHueso] = {};

    for (const kf of animador.keyframes) {
      const canal = kf.channel;           
      const tiempo = parseFloat(kf.time);

    
      const punto = kf.data_points[0];
      const x = valorNumero(punto.x);
      const y = valorNumero(punto.y);
      const z = valorNumero(punto.z);

      if (!resultado[nombreHueso][canal]) resultado[nombreHueso][canal] = [];
      resultado[nombreHueso][canal].push([tiempo, x, y, z]);
    }
  }

  for (const canales of Object.values(resultado)) {
    for (const lista of Object.values(canales)) {
      lista.sort((a, b) => a[0] - b[0]);
    }
  }

  return resultado;
}


// --------------------------------------
// SAMPLER
// Converts irregular keyframes into uniform samples at 1 tick (20 fps).
//----------------------------------------

function interpolarLineal(keyframes, ejeIndex, length, fps = 20) {

  const paso = 1 / fps;

  const n = Math.floor(length / paso);
  const t = Array.from({ length: n }, (_, i) => i * paso);
  const values = [];

  const tiempos = keyframes.map(kf => kf[0]);
  const vals    = keyframes.map(kf => kf[ejeIndex]);

  for (const ti of t) {
    if (ti <= tiempos[0]) {
      values.push(vals[0]);
      continue;
    }
    if (ti >= tiempos[tiempos.length - 1]) {
      values.push(vals[vals.length - 1]);
      continue;
    }

    let idx = 0;
    while (idx < tiempos.length - 2 && tiempos[idx + 1] < ti) idx++;

    const t0 = tiempos[idx],     t1 = tiempos[idx + 1];
    const v0 = vals[idx],        v1 = vals[idx + 1];
    const progreso = (ti - t0) / (t1 - t0);  // valor entre 0 y 1
    values.push(v0 + (v1 - v0) * progreso);   // interpolación lineal
  }

  return { t, values };
}

function muestrearCanal(keyframesCanal, length) {
  
  if (!keyframesCanal || keyframesCanal.length === 0) {
    const n = Math.floor(length * 20);
    const t = Array.from({ length: n }, (_, i) => i / 20);
    const ceros = new Array(n).fill(0);
    return { t, x: ceros, y: ceros, z: ceros };
  }

  const { t, values: x } = interpolarLineal(keyframesCanal, 1, length);
  const { values: y }    = interpolarLineal(keyframesCanal, 2, length);
  const { values: z }    = interpolarLineal(keyframesCanal, 3, length);
  return { t, x, y, z };
}


// ------------------------------
// CURVE FITTING
// ------------------------------

function fitFourier(t, values, period, nHarmonics = N_HARMONICS) {
  const w = (2 * Math.PI) / period;
  const n = t.length;
  const cols = 1 + nHarmonics * 2;  // offset + (sin + cos) * nHarmonics

  // Construct the matrix A (n rows × columns)
  // A[i] is row i, A[i][j] is the element in row i, column j.
  const A = [];
  for (let i = 0; i < n; i++) {
    const fila = [1];  
    for (let k = 1; k <= nHarmonics; k++) {
      fila.push(Math.sin(k * w * t[i]));
      fila.push(Math.cos(k * w * t[i]));
    }
    A.push(fila);
  }


  // These equations were done semi-manually, but I got frustrated and i telled to Claudio (Claude).
  const AtA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < cols; j++) {
      let suma = 0;
      for (let k = 0; k < n; k++) suma += A[k][i] * A[k][j];
      AtA[i][j] = suma;
    }
  }

  const Atb = new Array(cols).fill(0);
  for (let i = 0; i < cols; i++) {
    for (let k = 0; k < n; k++) Atb[i] += A[k][i] * values[k];
  }

  const coef = gaussianElimination(AtA, Atb);
  return { w, coef };
}

function gaussianElimination(A, b) {

  const n = b.length;

  const M = A.map((fila, i) => [...fila, b[i]]);

  for (let col = 0; col < n; col++) {

    let maxFila = col;
    for (let fila = col + 1; fila < n; fila++) {
      if (Math.abs(M[fila][col]) > Math.abs(M[maxFila][col])) maxFila = fila;
    }
    [M[col], M[maxFila]] = [M[maxFila], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) continue;  // columna casi cero, saltar


    for (let fila = col + 1; fila < n; fila++) {
      const factor = M[fila][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[fila][j] -= factor * M[col][j];
      }
    }
  }


  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

function fitPiecewise(keyframes, ejeIndex) {
  if (keyframes.length < 2) return [];

  const segmentos = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const t0 = keyframes[i][0],     t1 = keyframes[i + 1][0];
    const v0 = keyframes[i][ejeIndex], v1 = keyframes[i + 1][ejeIndex];
    if (Math.abs(v1 - v0) > 1e-6 || segmentos.length === 0) {
      segmentos.push([t0, t1, v0, v1]);
    }
  }
  return segmentos;
}


// ---------------------------------
// EMF EXPRESSION GENERATOR
// ----------------------------------

function redondear(valor, decimales = 4) {
  const r = parseFloat(valor.toFixed(decimales));
  return Math.abs(r) < 1e-4 ? 0 : r;
}

function expresionFourierAge(fit) {
  const { w, coef } = fit;
  const terminos = [];

  const D = redondear(coef[0]);
  if (D !== 0) terminos.push(String(D));

  let k = 1, i = 1;
  while (i < coef.length - 1) {
    const a = redondear(coef[i]);
    const b = redondear(coef[i + 1]);
    const R   = redondear(Math.sqrt(a * a + b * b));
    const phi = redondear(Math.atan2(b, a));

    if (R !== 0) {
      const kw = redondear(k * w);
      if (phi === 0) {
        terminos.push(`${R}*sin(${kw}*age/20)`);
      } else {
        terminos.push(`${R}*sin(${kw}*age/20+${phi})`);
      }
    }
    k++; i += 2;
  }

  if (terminos.length === 0) return "0";
  return terminos.join("+").replace(/\+-/g, "-");
}

function expresionFourierLimb(fit) {
  const { w, coef } = fit;
  const terminos = [];

  const D = redondear(coef[0]);

  let k = 1, i = 1;
  while (i < coef.length - 1) {
    const a = redondear(coef[i]);
    const b = redondear(coef[i + 1]);
    const R   = redondear(Math.sqrt(a * a + b * b));
    const phi = redondear(Math.atan2(b, a));

    if (R !== 0) {
      const kw = redondear(k * w / 20);
      if (phi === 0) {
        terminos.push(`limb_speed*${R}*sin(${kw}*limb_swing)`);
      } else {
        terminos.push(`limb_speed*${R}*sin(${kw}*limb_swing+${phi})`);
      }
    }
    k++; i += 2;
  }

  if (D !== 0) terminos.unshift(String(D));  
  if (terminos.length === 0) return "0";
  return terminos.join("+").replace(/\+-/g, "-");
}

function expresionPiecewise(segmentos, variable = "age/20") {
  if (!segmentos || segmentos.length === 0) return "0";

  const partes = [];
  for (const [t0, t1, v0, v1] of segmentos) {
    const dv = parseFloat((v1 - v0).toFixed(4));
    const dt = parseFloat((t1 - t0).toFixed(4));
    if (dv === 0 || Math.abs(dt) < 1e-9) continue;
    partes.push(`${dv}*clamp((${variable}-${t0.toFixed(4)})/${dt},0,1)`);
  }

  if (partes.length === 0) return String(parseFloat(segmentos[0][2].toFixed(4)));

  let expr = partes.join("+");
  const v0Global = parseFloat(segmentos[0][2].toFixed(4));
  if (v0Global !== 0) expr = `${v0Global}+${expr}`;
  return expr.replace(/\+-/g, "-");
}


// -----------------------------─
// .JEM TRANSLATION
// ------------------------------

function normalizarNombre(nombreBlockbench) {
  const clave = nombreBlockbench.toLowerCase().replace(/ /g, "_");
  return HUESOS_OFICIALES[clave] || clave;
}

function construirAnimations(expresionesPorHueso) {
  const animations = [];

  for (const [nombreHueso, canales] of Object.entries(expresionesPorHueso)) {
    const parte = normalizarNombre(nombreHueso);
    for (const [canal, ejes] of Object.entries(canales)) {
      const sufijos = SUFIJOS_CANAL[canal];
      if (!sufijos) continue;
      const nombresEje = ["x", "y", "z"];
      for (let i = 0; i < 3; i++) {
        const expr = ejes[nombresEje[i]] || "0";
        if (expr !== "0") {
          animations.push({ [`${parte}.${sufijos[i]}`]: expr });
        }
      }
    }
  }
  return animations;
}


// -----------------------------
//RESOURCE PACK
// ---------------------------------

function guardarResourcePack(animations, nombrePack, descripcion, versionMC, outputDir) {
  const fs   = require("fs");
  const path = require("path");

  const packFormat = PACK_FORMATS[versionMC] || 46;

  const mcmeta = JSON.stringify({
    pack: { pack_format: packFormat, description: descripcion }
  }, null, 2);

  const jemContenido = JSON.stringify({
    texture: "skins/steve.png",
    animations
  }, null, 2);

  const nombreCarpeta = nombrePack.replace(/ /g, "_");
  const raiz = path.join(outputDir, nombreCarpeta);
  const rutaCem = path.join(raiz, "assets", "minecraft", "optifine", "cem");

  fs.mkdirSync(rutaCem, { recursive: true });

  fs.writeFileSync(path.join(raiz, "pack.mcmeta"), mcmeta);
  fs.writeFileSync(path.join(rutaCem, "player.jem"),      jemContenido);
  fs.writeFileSync(path.join(rutaCem, "player_slim.jem"), jemContenido);

  Blockbench.showMessageBox({
    title: "EMF Animator",
    message: `Resource pack Saved in:\n${raiz}\n\nMade a .zip file and save it, after that use it as a resourcepack.`,
    buttons: ["OK"]
  });
}


// ------------------------------
// PRINCIPAL PIPELINE
// ------------------------------

function exportarAnimaciones() {
  if (!Project) {
    Blockbench.showMessageBox({
      title: "EMF Converter Addon",
      message: "There are no open projects.",
      buttons: ["OK"]
    });
    return;
  }

  const animaciones = listarAnimaciones();
  if (animaciones.length === 0) {
    Blockbench.showMessageBox({
      title: "EMF Converter Addon",
      message: "The model has no saved animations.\nCreate animations in the Animate tab and try again.",
      buttons: ["OK"]
    });
    return;
  }

  const uuidToName = obtenerHuesos();

  const dialog = new Dialog({
    title: "EMF Converter Addon | Export",
    form: buildForm(animaciones),  
    onConfirm(formData) {
      procesarYExportar(animaciones, uuidToName, formData);
    }
  });

  dialog.show();
}

function buildForm(animaciones) {
  const form = {
    _separador_anim: {
      type: "info",
      text: "Animation type for each one:"
    }
  };

  for (const anim of animaciones) {
    form[`tipo_${anim.uuid}`] = {
      label: `"${anim.name}"`,
      type: "select",
      value: "age",
      options: {
        age:    "Continuous loop — Idle, Breathing",
        limb:   "Movement cycle — Walk, Run",
        custom: "Custom - Eating, attack"
      }
    };
  }

  form._separador_custom = {
    type: "info",
    text: "Custom variable name"
  };

  form.variableCustom = {
    label: "Viriable Name",
    type: "text",
    value: "var.custom_progress"
  };

  form._separador_pack = {
    type: "info",
    text: "Resource Pack"
  };

  form.nombrePack = {
    label: "Name from Resource Pack",
    type: "text",
    value: "My Very Amazing Cool Animation Pack"
  };

  form.descripcion = {
    label: "Description",
    type: "text",
    value: "Animation created with EMF Converter Addon by Milo."
  };

  form.versionMC = {
    label: "Minecraft version",
    type: "select",
    value: "26.2",
    options: Object.fromEntries(Object.keys(PACK_FORMATS).map(v => [v, v]))
  };

  form.outputDir = {
    label: "Destination folder",
    type: "folder"
  };

  return form;
}

function procesarYExportar(animaciones, uuidToName, formData) {
  const allAnimations = [];

  for (const anim of animaciones) {
    const tipo = formData[`tipo_${anim.uuid}`];
    const variableCustom = formData.variableCustom || "var.custom_progress";

    const keyframesPorHueso = extraerKeyframes(anim, uuidToName);
    const length = parseFloat(anim.length) || 1;
    const expresionesPorHueso = {};

    for (const [nombreHueso, canales] of Object.entries(keyframesPorHueso)) {
      expresionesPorHueso[nombreHueso] = {};

      for (const [canal, listaKf] of Object.entries(canales)) {
        if (!SUFIJOS_CANAL[canal]) continue;

        const muestras = muestrearCanal(listaKf, length);
        const ejes = {};

        for (let idx = 0; idx < 3; idx++) {
          const eje = ["x", "y", "z"][idx];
          const values = muestras[eje];
          const t      = muestras.t;

          const max = Math.max(...values);
          const min = Math.min(...values);
          if (max - min < 0.01) { ejes[eje] = "0"; continue; }

          if (tipo === "age") {
            const fit = fitFourier(t, values, length);
            ejes[eje] = expresionFourierAge(fit);
          } else if (tipo === "limb") {
            const fit = fitFourier(t, values, length);
            ejes[eje] = expresionFourierLimb(fit);
          } else {
            const segmentos = fitPiecewise(listaKf, idx + 1);
            ejes[eje] = expresionPiecewise(segmentos, variableCustom);
          }
        }

        expresionesPorHueso[nombreHueso][canal] = ejes;
      }
    }

    const bloqueAnimations = construirAnimations(expresionesPorHueso);
    allAnimations.push(...bloqueAnimations);
  
  }

  if (allAnimations.length === 0) {
    Blockbench.showMessageBox({
      title: "EMF Converter Addon",
      message: "No expressions are being generated. Verify that the animations have moving keyframes",
      buttons: ["OK"]
    });
    return;
  }

  guardarResourcePack(
    allAnimations,
    formData.nombrePack,
    formData.descripcion,
    formData.versionMC,
    formData.outputDir
  );
}
