/**
 * Núcleo da aquarela — a mesma conta que `aquarela.py` faz.
 *
 * Não é recorte de fundo. Uma aquarela é pigmento translúcido *sobre* papel:
 * o que se vê em cada ponto é uma mistura entre a tinta e o papel por baixo.
 * Recortar por semelhança de cor destrói as aguadas claras, que são quase papel.
 *
 * Aqui se desfaz a mistura. Assumindo
 *
 *     observado = pigmento · cobertura + papel · (1 - cobertura)
 *
 * estima-se a cobertura pelo canal que mais escureceu em relação ao papel e
 * recupera-se o pigmento.
 *
 * Este arquivo não toca no DOM: a página e o teste de paridade usam os mesmos
 * quatro exportes. Toda a conta é em float64, como no numpy, e o corte para
 * byte é truncamento — não arredondamento — para casar com `astype(np.uint8)`.
 */

/** Uma fatia de linhas ou colunas, com o mesmo recorte que o numpy faria. */
function fatia(inicio, fim, tamanho) {
  const a = Math.max(0, inicio < 0 ? tamanho + inicio : inicio);
  const b = Math.min(tamanho, fim < 0 ? tamanho + fim : fim);
  const saida = [];
  for (let i = a; i < b; i += 1) saida.push(i);
  return saida;
}

function mediana(valores) {
  const ordenado = Float64Array.from(valores).sort();
  const n = ordenado.length;
  if (n === 0) return 0;
  const meio = n >> 1;
  // np.median: em contagem par, a média dos dois centrais.
  return n % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

/**
 * Cor do papel medida nas bordas, onde raramente há tinta.
 *
 * As quatro faixas são concatenadas como no numpy — os cantos entram duas
 * vezes, e isso muda a mediana, então a repetição é proposital.
 */
export function estimarPapel(dados, largura, altura, margem = 6) {
  const canais = [[], [], []];
  const junta = (linhas, colunas) => {
    for (const y of linhas) {
      for (const x of colunas) {
        const i = (y * largura + x) * 4;
        canais[0].push(dados[i]);
        canais[1].push(dados[i + 1]);
        canais[2].push(dados[i + 2]);
      }
    }
  };
  const todasLinhas = fatia(0, altura, altura);
  const todasColunas = fatia(0, largura, largura);
  junta(fatia(0, margem, altura), todasColunas);
  junta(fatia(-margem, altura, altura), todasColunas);
  junta(todasLinhas, fatia(0, margem, largura));
  junta(todasLinhas, fatia(-margem, largura, largura));
  return canais.map(mediana);
}

/**
 * Separa pigmento e cobertura. Devolve RGBA de alfa reto (não pré-multiplicado)
 * e as proporções de papel, aguada e tinta cheia.
 */
export function separar(dados, largura, altura, { papel, limpar = 0.02, ganho = 1 }) {
  const [pr, pg, pb] = papel;
  // O numpy divide por max(papel, 1) para não estourar num papel preto.
  const sr = Math.max(pr, 1);
  const sg = Math.max(pg, 1);
  const sb = Math.max(pb, 1);

  const total = largura * altura;
  const rgba = new Uint8ClampedArray(total * 4);
  let transparentes = 0;
  let opacos = 0;

  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const r = dados[i];
    const g = dados[i + 1];
    const b = dados[i + 2];

    // Quanto cada canal escureceu em relação ao papel, em proporção.
    const escurecimento = Math.max((pr - r) / sr, (pg - g) / sg, (pb - b) / sb);
    let a = escurecimento * ganho;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    // Ruído de compressão perto do papel vira transparência limpa.
    if (a < limpar) a = 0;

    if (a === 0) transparentes += 1;
    else if (a > 0.98) opacos += 1;

    // pigmento = (observado - papel · (1 - a)) / a
    // Com a = 0 o numpy devolve nan (0/0) ou ±inf; nan e -inf viram 0, +inf 255.
    for (let c = 0; c < 3; c += 1) {
      const obs = dados[i + c];
      const pap = papel[c];
      let v;
      if (a === 0) {
        const num = obs - pap;
        v = num > 0 ? 255 : 0;
      } else {
        v = (obs - pap * (1 - a)) / a;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      rgba[i + c] = Math.floor(v);
    }
    rgba[i + 3] = Math.floor(a * 255);
  }

  return {
    rgba,
    largura,
    altura,
    estatisticas: {
      transparente: transparentes / total,
      opaco: opacos / total,
      aguada: (total - transparentes - opacos) / total,
    },
  };
}

/**
 * Corta as margens transparentes.
 *
 * `limiar` é o alfa a partir do qual o pixel conta como desenho. Zero corta só
 * o que é papel puro; subir um pouco descarta a poeira de aguada que sobra
 * longe do traço e aperta o corte de verdade. `margem` devolve uma folga.
 */
export function caixaVisivel(rgba, largura, altura, limiar = 0) {
  let cima = altura;
  let baixo = -1;
  let esquerda = largura;
  let direita = -1;

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      if (rgba[(y * largura + x) * 4 + 3] <= limiar) continue;
      if (y < cima) cima = y;
      if (y > baixo) baixo = y;
      if (x < esquerda) esquerda = x;
      if (x > direita) direita = x;
    }
  }
  return baixo < 0 ? null : { cima, baixo, esquerda, direita };
}

export function aparar(rgba, largura, altura, { limiar = 0, margem = 0 } = {}) {
  const caixa = caixaVisivel(rgba, largura, altura, limiar);
  if (!caixa) return { rgba, largura, altura, corte: null };
  let { cima, baixo, esquerda, direita } = caixa;

  cima = Math.max(0, cima - margem);
  esquerda = Math.max(0, esquerda - margem);
  baixo = Math.min(altura - 1, baixo + margem);
  direita = Math.min(largura - 1, direita + margem);

  const nl = direita - esquerda + 1;
  const na = baixo - cima + 1;
  const saida = new Uint8ClampedArray(nl * na * 4);
  for (let y = 0; y < na; y += 1) {
    const origem = ((cima + y) * largura + esquerda) * 4;
    saida.set(rgba.subarray(origem, origem + nl * 4), y * nl * 4);
  }
  return { rgba: saida, largura: nl, altura: na, corte: { esquerda, cima, nl, na } };
}

/**
 * Caixa do desenho medida direto na imagem de origem, sem montar o RGBA.
 *
 * A cobertura de um pixel depende só da origem, do papel e dos dois
 * parâmetros — então dá para varrer a imagem cheia e achar o corte exato sem
 * alocar os megabytes do resultado. É o que permite mostrar na tela o tamanho
 * que o arquivo terá de verdade, em vez de uma estimativa feita na prévia.
 */
export function caixaNaOrigem(dados, largura, altura, { papel, limpar, ganho, limiar = 0 }) {
  const [pr, pg, pb] = papel;
  const sr = Math.max(pr, 1);
  const sg = Math.max(pg, 1);
  const sb = Math.max(pb, 1);

  let cima = altura;
  let baixo = -1;
  let esquerda = largura;
  let direita = -1;

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 4;
      const e = Math.max(
        (pr - dados[i]) / sr, (pg - dados[i + 1]) / sg, (pb - dados[i + 2]) / sb,
      );
      let a = e * ganho;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (a < limpar) a = 0;
      // O limiar é comparado com o mesmo byte que seria gravado no alfa.
      if (Math.floor(a * 255) <= limiar) continue;
      if (y < cima) cima = y;
      if (y > baixo) baixo = y;
      if (x < esquerda) esquerda = x;
      if (x > direita) direita = x;
    }
  }
  return baixo < 0 ? null : { cima, baixo, esquerda, direita };
}

/** Satura o pigmento. Mexe só no RGB: o alfa é a cobertura, não a cor. */
export function saturar(rgba, fator) {
  if (fator === 1) return rgba;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    rgba[i] = luz + (r - luz) * fator;
    rgba[i + 1] = luz + (g - luz) * fator;
    rgba[i + 2] = luz + (b - luz) * fator;
  }
  return rgba;
}
