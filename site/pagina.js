/**
 * Interface da página. Toda a matemática mora em `aquarela.js`; aqui só se
 * cuida de telas, controles e do arquivo que sai no fim.
 *
 * A imagem é guardada em duas resoluções: a cheia, para gravar, e uma reduzida,
 * para a prévia. Assim arrastar um controle recalcula alguns milhões de pixels
 * a menos e a resposta continua imediata numa varredura grande.
 */

import { aparar, caixaNaOrigem, caixaVisivel, estimarPapel, saturar, separar } from './aquarela.js';

const LARGURA_PREVIA = 1100;

const $ = (id) => document.getElementById(id);

const elementos = {
  entrada: $('entrada'), arquivo: $('arquivo'), oficina: $('oficina'),
  palco: $('palco'), alca: $('alca'), marcaCorte: $('marcaCorte'),
  telaAntes: $('telaAntes'), telaDepois: $('telaDepois'),
  avisoAlfa: $('avisoAlfa'),
  ganho: $('ganho'), limpar: $('limpar'), saturacao: $('saturacao'),
  aparar: $('aparar'), limiarCorte: $('limiarCorte'), margemCorte: $('margemCorte'),
  largura: $('largura'), formato: $('formato'), qualidade: $('qualidade'),
  campoQualidade: $('campoQualidade'), nome: $('nome'),
  papelHex: $('papelHex'), papelMostra: $('papelMostra'),
  modo: $('modo'), tolerancia: $('tolerancia'), suavidade: $('suavidade'), resto: $('resto'),
  conectado: $('conectado'), parecido: $('parecido'), banda: $('banda'), ilha: $('ilha'),
  rotuloPapel: $('rotuloPapel'),
  btPapelAuto: $('btPapelAuto'), btConta: $('btConta'),
  btGravar: $('btGravar'), btOutra: $('btOutra'), btLarguraCheia: $('btLarguraCheia'),
};

const estado = {
  cheia: null,     // ImageData na resolução original
  previa: null,    // ImageData reduzida
  escala: 1,       // previa → cheia
  papelAuto: null,   // medido uma vez, na resolução cheia
  papelManual: null,
  contaGotas: false,
  cortina: 50,
  peso: null,      // bytes da última gravação
  medindo: null,   // temporizador da medição exata do corte
};

/* --- Entrada da imagem --------------------------------------------------- */

async function carregar(origem) {
  const bitmap = await createImageBitmap(origem);
  const { width: L, height: A } = bitmap;

  const tela = new OffscreenCanvas(L, A);
  const ctx = tela.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  estado.cheia = ctx.getImageData(0, 0, L, A);

  // Uma imagem que já tem alfa quase certamente já passou pela ferramenta.
  let temAlfa = false;
  const d = estado.cheia.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) { temAlfa = true; break; }
  }
  elementos.avisoAlfa.classList.toggle('oculto', !temAlfa);

  const escala = Math.min(1, LARGURA_PREVIA / L);
  if (escala < 1) {
    const pL = Math.max(1, Math.round(L * escala));
    const pA = Math.max(1, Math.round(A * escala));
    const t2 = new OffscreenCanvas(pL, pA);
    const c2 = t2.getContext('2d', { willReadFrequently: true });
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(bitmap, 0, 0, pL, pA);
    estado.previa = c2.getImageData(0, 0, pL, pA);
  } else {
    estado.previa = estado.cheia;
  }
  estado.escala = L / estado.previa.width;
  // Medido na imagem cheia e reaproveitado pela prévia: assim o que a tela
  // mostra é exatamente o que o arquivo gravado terá.
  estado.papelAuto = estimarPapel(estado.cheia.data, L, A);
  bitmap.close?.();

  elementos.largura.value = L;
  elementos.largura.max = L;
  $('nEntrada').textContent = `${L} × ${A}`;

  desenharAntes();
  elementos.entrada.classList.add('oculto');
  elementos.oficina.classList.remove('oculto');
  aplicar();
}

function desenharAntes() {
  const { width: L, height: A } = estado.previa;
  for (const tela of [elementos.telaAntes, elementos.telaDepois]) {
    tela.width = L;
    tela.height = A;
  }
  elementos.telaAntes.getContext('2d').putImageData(estado.previa, 0, 0);
  // A proporção deixa o CSS limitar o palco pela altura em telas estreitas.
  elementos.palco.style.setProperty('--proporcao', String(L / A));
}

/* --- O cálculo ----------------------------------------------------------- */

function parametros() {
  return {
    modo: elementos.modo.value,
    limpar: Number(elementos.limpar.value),
    ganho: Number(elementos.ganho.value),
    tolerancia: Number(elementos.tolerancia.value),
    suavidade: Number(elementos.suavidade.value),
    resto: Number(elementos.resto.value) / 100,
    conectado: elementos.conectado.checked ? Number(elementos.parecido.value) : 0,
    banda: Number(elementos.banda.value),
    maiorIlha: Number(elementos.ilha.value),
    saturacao: Number(elementos.saturacao.value) / 100,
    aparar: elementos.aparar.checked,
    limiar: Number(elementos.limiarCorte.value),
    margem: Number(elementos.margemCorte.value),
  };
}

/** Roda o núcleo sobre uma ImageData e devolve o RGBA já saturado. */
function processar(imagem, p, margemEmEscala = 1) {
  const { data, width: L, height: A } = imagem;
  const papel = estado.papelManual ?? estado.papelAuto;
  const { rgba, estatisticas } = separar(data, L, A, { ...p, papel });
  saturar(rgba, p.saturacao);
  const corte = p.aparar
    ? aparar(rgba, L, A, {
        limiar: p.limiar,
        margem: Math.round(p.margem * margemEmEscala),
      })
    : { rgba, largura: L, altura: A, corte: null };
  return { ...corte, papel, estatisticas };
}

let pendente = null;

function aplicar() {
  if (!estado.previa) return;
  if (pendente) cancelAnimationFrame(pendente);
  pendente = requestAnimationFrame(() => {
    pendente = null;
    const p = parametros();
    // Na prévia o corte não recorta a tela: ele vira tracejado, senão o antes
    // e o depois deixariam de estar alinhados sob a cortina.
    const r = processar(estado.previa, { ...p, aparar: false });

    const ctx = elementos.telaDepois.getContext('2d');
    ctx.putImageData(new ImageData(r.rgba, r.largura, r.altura), 0, 0);

    mostrarNumeros(r, p);
    mostrarCorte(r, p);
  });
}

function mostrarCorte(r, p) {
  if (!p.aparar) {
    elementos.marcaCorte.classList.add('oculto');
    return;
  }
  const { width: L, height: A } = estado.previa;
  const caixa = caixaVisivel(r.rgba, L, A, p.limiar);
  if (!caixa) { elementos.marcaCorte.classList.add('oculto'); return; }

  // A folga é dada em pixels da imagem cheia; na prévia ela encolhe junto.
  const folga = p.margem / estado.escala;
  const esquerda = Math.max(0, caixa.esquerda - folga);
  const cima = Math.max(0, caixa.cima - folga);
  const direita = Math.min(L - 1, caixa.direita + folga);
  const baixo = Math.min(A - 1, caixa.baixo + folga);

  elementos.marcaCorte.classList.remove('oculto');
  const e = elementos.marcaCorte.style;
  e.left = `${(esquerda / L) * 100}%`;
  e.top = `${(cima / A) * 100}%`;
  e.right = `${100 - ((direita + 1) / L) * 100}%`;
  e.bottom = `${100 - ((baixo + 1) / A) * 100}%`;

  // O número na tela vem da prévia, que erra por alguns pixels. Assim que os
  // controles param, a caixa é medida de novo na imagem cheia e o valor exato
  // — o que o arquivo terá — substitui a estimativa.
  escreverSaida(
    (direita - esquerda + 1) * estado.escala,
    (baixo - cima + 1) * estado.escala,
  );
  medirCorteExato(p);
}

function escreverSaida(largura, altura) {
  const alvo = Number(elementos.largura.value) || estado.cheia.width;
  const fator = alvo / estado.cheia.width;
  $('nSaida').textContent =
    `${Math.round(largura * fator)} × ${Math.round(altura * fator)}`;
}

function medirCorteExato(p) {
  clearTimeout(estado.medindo);
  estado.medindo = setTimeout(() => {
    const { data, width: L, height: A } = estado.cheia;
    const caixa = caixaNaOrigem(data, L, A, {
      ...p,
      papel: estado.papelManual ?? estado.papelAuto,
      limiar: p.limiar,
    });
    if (!caixa) return;
    const esquerda = Math.max(0, caixa.esquerda - p.margem);
    const cima = Math.max(0, caixa.cima - p.margem);
    const direita = Math.min(L - 1, caixa.direita + p.margem);
    const baixo = Math.min(A - 1, caixa.baixo + p.margem);
    escreverSaida(direita - esquerda + 1, baixo - cima + 1);
  }, 180);
}

function mostrarNumeros(r, p) {
  const { transparente, aguada, opaco } = r.estatisticas;
  $('nT').textContent = `${(transparente * 100).toFixed(0)}%`;
  $('nA').textContent = `${(aguada * 100).toFixed(0)}%`;
  $('nO').textContent = `${(opaco * 100).toFixed(0)}%`;
  $('bT').style.width = `${transparente * 100}%`;
  $('bA').style.width = `${aguada * 100}%`;
  $('bO').style.width = `${opaco * 100}%`;

  const hexa = '#' + r.papel.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  $('nPapel').textContent = hexa;
  elementos.papelMostra.style.background = hexa;
  if (!estado.papelManual) elementos.papelHex.value = hexa;

  if (!p.aparar) {
    const alvo = Number(elementos.largura.value) || estado.cheia.width;
    const fator = alvo / estado.cheia.width;
    $('nSaida').textContent =
      `${Math.round(estado.cheia.width * fator)} × ${Math.round(estado.cheia.height * fator)}`;
  }
  $('nPeso').textContent = estado.peso ? formatarPeso(estado.peso) : 'grave para saber';
}

const formatarPeso = (b) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/* --- Gravar -------------------------------------------------------------- */

async function gravar() {
  elementos.btGravar.disabled = true;
  elementos.btGravar.textContent = 'Gravando…';
  try {
    const p = parametros();
    const r = processar(estado.cheia, p);

    let tela = new OffscreenCanvas(r.largura, r.altura);
    tela.getContext('2d').putImageData(new ImageData(r.rgba, r.largura, r.altura), 0, 0);

    const alvo = Math.max(16, Number(elementos.largura.value) || estado.cheia.width);
    const fator = alvo / estado.cheia.width;
    if (Math.abs(fator - 1) > 0.001) {
      const nL = Math.max(1, Math.round(r.largura * fator));
      const nA = Math.max(1, Math.round(r.altura * fator));
      const t2 = new OffscreenCanvas(nL, nA);
      const c2 = t2.getContext('2d');
      c2.imageSmoothingEnabled = true;
      c2.imageSmoothingQuality = 'high';
      c2.drawImage(tela, 0, 0, nL, nA);
      tela = t2;
    }

    const tipo = elementos.formato.value;
    const blob = await tela.convertToBlob({
      type: tipo,
      quality: tipo === 'image/webp' ? Number(elementos.qualidade.value) / 100 : undefined,
    });
    estado.peso = blob.size;
    $('nPeso').textContent = formatarPeso(blob.size);

    const extensao = tipo === 'image/webp' ? 'webp' : 'png';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(elementos.nome.value || 'aquarela').replace(/\.\w+$/, '')}.${extensao}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } finally {
    elementos.btGravar.disabled = false;
    elementos.btGravar.textContent = 'Gravar';
  }
}

/* --- Cortina ------------------------------------------------------------- */

function moverCortina(clienteX) {
  const r = elementos.palco.getBoundingClientRect();
  const pct = Math.min(100, Math.max(0, ((clienteX - r.left) / r.width) * 100));
  estado.cortina = pct;
  elementos.palco.style.setProperty('--corte', `${pct}%`);
  elementos.alca.setAttribute('aria-valuenow', Math.round(pct));
}

elementos.palco.addEventListener('pointerdown', (e) => {
  elementos.palco.setPointerCapture(e.pointerId);
  if (estado.contaGotas) { pegarPapel(e); return; }
  moverCortina(e.clientX);
});
elementos.palco.addEventListener('pointermove', (e) => {
  if (e.buttons && !estado.contaGotas) moverCortina(e.clientX);
});
elementos.alca.addEventListener('keydown', (e) => {
  const passo = e.shiftKey ? 10 : 2;
  if (e.key === 'ArrowLeft') estado.cortina -= passo;
  else if (e.key === 'ArrowRight') estado.cortina += passo;
  else return;
  e.preventDefault();
  estado.cortina = Math.min(100, Math.max(0, estado.cortina));
  elementos.palco.style.setProperty('--corte', `${estado.cortina}%`);
  elementos.alca.setAttribute('aria-valuenow', Math.round(estado.cortina));
});

/* --- Conta-gotas --------------------------------------------------------- */

function pegarPapel(e) {
  const r = elementos.palco.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * estado.previa.width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * estado.previa.height);
  const i = (y * estado.previa.width + x) * 4;
  const d = estado.previa.data;
  estado.papelManual = [d[i], d[i + 1], d[i + 2]];
  elementos.papelHex.disabled = false;
  elementos.papelHex.value =
    '#' + estado.papelManual.map((c) => c.toString(16).padStart(2, '0')).join('');
  $('vPapel').textContent = 'escolhido';
  elementos.btPapelAuto.setAttribute('aria-pressed', 'false');
  desligarContaGotas();
  aplicar();
}

function desligarContaGotas() {
  estado.contaGotas = false;
  elementos.btConta.setAttribute('aria-pressed', 'false');
  elementos.palco.style.cursor = '';
}

/* --- Ligações ------------------------------------------------------------ */

const rotulos = [
  ['ganho', 'vGanho', (v) => Number(v).toFixed(2)],
  ['limpar', 'vLimpar', (v) => Number(v).toFixed(3)],
  ['saturacao', 'vSaturacao', (v) => `${v}%`],
  ['limiarCorte', 'vLimiarCorte', (v) => v],
  ['margemCorte', 'vMargemCorte', (v) => `${v} px`],
  ['qualidade', 'vQualidade', (v) => v],
  ['tolerancia', 'vTolerancia', (v) => v],
  ['suavidade', 'vSuavidade', (v) => v],
  ['resto', 'vResto', (v) => `${v}%`],
  ['parecido', 'vParecido', (v) => v],
  ['banda', 'vBanda', (v) => `${v} px`],
  ['ilha', 'vIlha', (v) => (Number(v) ? `acima de ${v} px` : 'desligado')],
];

for (const [alvo, saida, formatar] of rotulos) {
  const el = elementos[alvo] ?? $(alvo);
  const atualizar = () => { $(saida).textContent = formatar(el.value); };
  el.addEventListener('input', () => { atualizar(); aplicar(); });
  atualizar();
}

// Cada modo mostra só os seus controles: ganho e limpar não significam nada
// contra fundo chapado, e tolerância não significa nada sobre papel.
function trocarModo() {
  const modo = elementos.modo.value;
  for (const campo of document.querySelectorAll('[data-modo]')) {
    campo.hidden = campo.dataset.modo !== modo;
  }
  elementos.rotuloPapel.textContent = modo === 'chapado' ? 'Cor do fundo' : 'Papel';
  // Os dois controles da inundação só existem quando ela está ligada.
  for (const campo of document.querySelectorAll('[data-conectado]')) {
    campo.hidden = modo !== 'chapado' || !elementos.conectado.checked;
  }
  aplicar();
}
elementos.conectado.addEventListener('change', trocarModo);
elementos.modo.addEventListener('change', trocarModo);
trocarModo();

elementos.aparar.addEventListener('change', aplicar);
elementos.largura.addEventListener('input', () => {
  $('vLargura').textContent = `de ${estado.cheia?.width ?? '—'} px`;
  aplicar();
});
elementos.formato.addEventListener('change', () => {
  elementos.campoQualidade.classList.toggle(
    'oculto', elementos.formato.value !== 'image/webp',
  );
});
elementos.btLarguraCheia.addEventListener('click', () => {
  elementos.largura.value = estado.cheia.width;
  aplicar();
});
elementos.btGravar.addEventListener('click', gravar);
elementos.btOutra.addEventListener('click', () => {
  elementos.oficina.classList.add('oculto');
  elementos.entrada.classList.remove('oculto');
  estado.papelManual = null;
  estado.peso = null;
  elementos.btPapelAuto.setAttribute('aria-pressed', 'true');
  elementos.papelHex.disabled = true;
  $('vPapel').textContent = 'medido nas bordas';
});

elementos.btPapelAuto.addEventListener('click', () => {
  estado.papelManual = null;
  elementos.papelHex.disabled = true;
  elementos.btPapelAuto.setAttribute('aria-pressed', 'true');
  $('vPapel').textContent = 'medido nas bordas';
  desligarContaGotas();
  aplicar();
});
elementos.btConta.addEventListener('click', () => {
  estado.contaGotas = !estado.contaGotas;
  elementos.btConta.setAttribute('aria-pressed', String(estado.contaGotas));
  elementos.palco.style.cursor = estado.contaGotas ? 'crosshair' : '';
});
elementos.papelHex.addEventListener('input', () => {
  const v = elementos.papelHex.value.slice(1);
  estado.papelManual = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  elementos.btPapelAuto.setAttribute('aria-pressed', 'false');
  $('vPapel').textContent = 'escolhido';
  aplicar();
});

for (const b of document.querySelectorAll('.fundos button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.fundos button')) {
      o.setAttribute('aria-pressed', String(o === b));
    }
    elementos.palco.dataset.fundo = b.dataset.fundo;
  });
}

/* --- Como a imagem chega ------------------------------------------------- */

elementos.entrada.addEventListener('click', () => elementos.arquivo.click());
elementos.entrada.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elementos.arquivo.click(); }
});
elementos.arquivo.addEventListener('change', () => {
  if (elementos.arquivo.files[0]) carregar(elementos.arquivo.files[0]);
});

for (const evento of ['dragenter', 'dragover']) {
  elementos.entrada.addEventListener(evento, (e) => {
    e.preventDefault();
    elementos.entrada.dataset.sobre = 'sim';
  });
}
for (const evento of ['dragleave', 'drop']) {
  elementos.entrada.addEventListener(evento, (e) => {
    e.preventDefault();
    delete elementos.entrada.dataset.sobre;
  });
}
elementos.entrada.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) carregar(f);
});

window.addEventListener('paste', (e) => {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) { carregar(f); return; }
    }
  }
});

elementos.palco.style.setProperty('--corte', '50%');
