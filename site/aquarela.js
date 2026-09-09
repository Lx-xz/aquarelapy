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
 * Cobertura num ponto, pelos dois modos.
 *
 * "aquarela": a tinta translúcida só escurece o papel, então a cobertura sai do
 * canal que mais escureceu, em proporção à folga que havia até o preto.
 *
 * "chapado": o fundo não está por baixo da tinta, está atrás de um desenho que
 * costuma ser opaco. O que separa os dois é a *distância de cor*, não o
 * escurecimento — um cinza neutro está longe de um verde mesmo tendo brilho
 * parecido, e é isso que a medida por canal não enxerga. Sem este modo, um
 * desenho claro sobre fundo colorido some inteiro.
 */
function coberturaEm(r, g, b, o) {
  if (o.modo === 'chapado') {
    // Raiz da soma dos quadrados, e não Math.hypot: o hypot escalona os termos
    // e diverge do numpy no último bit.
    const dr = r - o.pr, dg = g - o.pg, db = b - o.pb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    const a = (d - o.tolerancia) / Math.max(o.suavidade, 1);
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }
  let a = Math.max((o.pr - r) / o.sr, (o.pg - g) / o.sg, (o.pb - b) / o.sb) * o.ganho;
  a = a < 0 ? 0 : a > 1 ? 1 : a;
  return a < o.limpar ? 0 : a;
}

function preparar(papel, op) {
  const [pr, pg, pb] = papel;
  const media = (pr + pg + pb) / 3;
  const dir = [pr - media, pg - media, pb - media];
  const norma = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  return {
    pr, pg, pb,
    // O numpy divide por max(papel, 1) para não estourar num papel preto.
    sr: Math.max(pr, 1), sg: Math.max(pg, 1), sb: Math.max(pb, 1),
    modo: op.modo ?? 'aquarela',
    limpar: op.limpar ?? 0.02,
    ganho: op.ganho ?? 1,
    tolerancia: op.tolerancia ?? 30,
    suavidade: op.suavidade ?? 60,
    resto: op.resto ?? 0,
    conectado: op.conectado ?? 0,
    banda: op.banda ?? 3,
    maiorIlha: op.maiorIlha ?? 0,
    // Direção do matiz do fundo, para tirar a franja das bordas.
    dir: norma < 1e-6 ? null : dir.map((c) => c / norma),
  };
}

/**
 * Marca o fundo que *encosta na borda* do quadro.
 *
 * Cor sozinha não distingue o fundo de uma parte do desenho que por acaso tem a
 * cor dele — a sobrancelha escura de um grifo sobre preto é o exemplo. Quem
 * distingue é a vizinhança: o fundo é uma região contínua que chega até a borda.
 * Uma ilha da mesma cor, cercada de desenho, não é fundo.
 *
 * Inundação por vizinhança de quatro, com pilha em Int32Array — uma fila de
 * objetos aqui custaria mais que toda a separação.
 */
export function fundoConectado(dados, largura, altura, papel, parecido) {
  const [pr, pg, pb] = papel;
  const total = largura * altura;
  const marca = new Uint8Array(total);
  const pilha = new Int32Array(total);
  let topo = 0;

  const candidato = (i) => {
    const j = i * 4;
    const dr = dados[j] - pr, dg = dados[j + 1] - pg, db = dados[j + 2] - pb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < parecido;
  };
  const semear = (i) => {
    if (!marca[i] && candidato(i)) { marca[i] = 1; pilha[topo++] = i; }
  };

  for (let x = 0; x < largura; x += 1) {
    semear(x);
    semear((altura - 1) * largura + x);
  }
  for (let y = 0; y < altura; y += 1) {
    semear(y * largura);
    semear(y * largura + largura - 1);
  }

  while (topo > 0) {
    const i = pilha[--topo];
    const x = i % largura;
    if (x > 0) semear(i - 1);
    if (x < largura - 1) semear(i + 1);
    if (i >= largura) semear(i - largura);
    if (i + largura < total) semear(i + largura);
  }
  return marca;
}

/**
 * Devolve ao fundo as ilhas grandes cercadas pelo desenho.
 *
 * A inundação não chega a um bolsão de fundo fechado pelo próprio desenho — o
 * vão entre o corpo e a asa de um grifo. Ele ficaria opaco, como se fosse tinta.
 * O que separa um bolsão de um detalhe é o tamanho: medido numa ilustração, as
 * duas ilhas de fundo tinham 11.716 e 2.726 pixels, e as 1.273 ilhas de traço
 * escuro tinham todas menos de 500.
 */
export function abrirBolsoes(dados, largura, altura, papel, parecido, marca, maiorIlha) {
  if (maiorIlha <= 0) return marca;
  const [pr, pg, pb] = papel;
  const total = largura * altura;
  const visto = new Uint8Array(total);
  const grupo = new Int32Array(total);

  const ehIlha = (i) => {
    if (marca[i]) return false;
    const j = i * 4;
    const dr = dados[j] - pr, dg = dados[j + 1] - pg, db = dados[j + 2] - pb;
    return Math.sqrt(dr * dr + dg * dg + db * db) < parecido;
  };

  for (let semente = 0; semente < total; semente += 1) {
    if (visto[semente] || !ehIlha(semente)) continue;
    let fim = 0;
    grupo[fim++] = semente;
    visto[semente] = 1;
    for (let k = 0; k < fim; k += 1) {
      const i = grupo[k];
      const x = i % largura;
      if (x > 0 && !visto[i - 1] && ehIlha(i - 1)) { visto[i - 1] = 1; grupo[fim++] = i - 1; }
      if (x < largura - 1 && !visto[i + 1] && ehIlha(i + 1)) { visto[i + 1] = 1; grupo[fim++] = i + 1; }
      if (i >= largura && !visto[i - largura] && ehIlha(i - largura)) {
        visto[i - largura] = 1; grupo[fim++] = i - largura;
      }
      if (i + largura < total && !visto[i + largura] && ehIlha(i + largura)) {
        visto[i + largura] = 1; grupo[fim++] = i + largura;
      }
    }
    if (fim > maiorIlha) {
      for (let k = 0; k < fim; k += 1) marca[grupo[k]] = 1;
    }
  }
  return marca;
}

/** Engorda a máscara em `passos` pixels, por vizinhança de quatro. */
export function dilatar(marca, largura, altura, passos) {
  let atual = marca;
  for (let p = 0; p < passos; p += 1) {
    const proxima = atual.slice();
    for (let y = 0; y < altura; y += 1) {
      for (let x = 0; x < largura; x += 1) {
        const i = y * largura + x;
        if (atual[i]) continue;
        if ((x > 0 && atual[i - 1]) || (x < largura - 1 && atual[i + 1])
          || (y > 0 && atual[i - largura]) || (y < altura - 1 && atual[i + largura])) {
          proxima[i] = 1;
        }
      }
    }
    atual = proxima;
  }
  return atual;
}

/**
 * Separa pigmento e cobertura. Devolve RGBA de alfa reto (não pré-multiplicado)
 * e as proporções de fundo, aguada e tinta cheia.
 */
export function separar(dados, largura, altura, opcoes) {
  const o = preparar(opcoes.papel, opcoes);
  const papel = opcoes.papel;

  const total = largura * altura;

  // A inundação decide *o que* é fundo; a rampa decide só a maciez da borda.
  // Com o miolo protegido, a rampa pode ser larga sem comer o desenho — era
  // essa amarra que fazia o fundo preto apagar a sobrancelha.
  let fora = null;
  let dentro = null;
  if (o.conectado > 0) {
    fora = fundoConectado(dados, largura, altura, papel, o.conectado);
    fora = abrirBolsoes(dados, largura, altura, papel, o.conectado, fora, o.maiorIlha);
    const faixa = dilatar(fora, largura, altura, o.banda);
    dentro = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) dentro[i] = !fora[i] && !faixa[i] ? 1 : 0;
  }
  const rgba = new Uint8ClampedArray(total * 4);
  let transparentes = 0;
  let opacos = 0;

  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const r = dados[i];
    const g = dados[i + 1];
    const b = dados[i + 2];

    let a = coberturaEm(r, g, b, o);
    if (fora) a = fora[p] ? 0 : dentro[p] ? 1 : a;

    if (a === 0) transparentes += 1;
    else if (a > 0.98) opacos += 1;

    // pigmento = (observado - papel · (1 - a)) / a
    // Com a = 0 o numpy devolve nan (0/0) ou ±inf; nan e -inf viram 0, +inf 255.
    const pig = [0, 0, 0];
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
      pig[c] = v;
    }

    // Tira das bordas o resto do matiz do fundo: sai só a parte da cor que
    // aponta para o matiz do fundo mais forte do que aponta para qualquer outro
    // lado. Uma franja verde é quase toda componente verde e sai inteira; um
    // ocre contém verde, mas contém muito mais vermelho, e não é tocado.
    if (o.resto > 0 && o.dir) {
      const cinza = (pig[0] + pig[1] + pig[2]) / 3;
      const c0 = pig[0] - cinza, c1 = pig[1] - cinza, c2 = pig[2] - cinza;
      const aoLongo = c0 * o.dir[0] + c1 * o.dir[1] + c2 * o.dir[2];
      const perp = Math.sqrt(
        Math.max(c0 * c0 + c1 * c1 + c2 * c2 - aoLongo * aoLongo, 0),
      );
      const excesso = aoLongo - perp;
      if (excesso > 0) {
        for (let c = 0; c < 3; c += 1) {
          const v = pig[c] - o.dir[c] * excesso * o.resto;
          pig[c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }

    for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.floor(pig[c]);
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
export function caixaNaOrigem(dados, largura, altura, opcoes) {
  const o = preparar(opcoes.papel, opcoes);
  const limiar = opcoes.limiar ?? 0;

  let fora = null;
  let dentro = null;
  if (o.conectado > 0) {
    fora = fundoConectado(dados, largura, altura, opcoes.papel, o.conectado);
    fora = abrirBolsoes(dados, largura, altura, opcoes.papel, o.conectado, fora, o.maiorIlha);
    const faixa = dilatar(fora, largura, altura, o.banda);
    dentro = new Uint8Array(largura * altura);
    for (let i = 0; i < largura * altura; i += 1) dentro[i] = !fora[i] && !faixa[i] ? 1 : 0;
  }

  let cima = altura;
  let baixo = -1;
  let esquerda = largura;
  let direita = -1;

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const p = y * largura + x;
      const i = p * 4;
      let a = coberturaEm(dados[i], dados[i + 1], dados[i + 2], o);
      if (fora) a = fora[p] ? 0 : dentro[p] ? 1 : a;
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
