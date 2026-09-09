# Aquarela

Tira o fundo de uma ilustração e devolve um PNG com transparência real.

Em ambos os modos o pigmento é recuperado do mesmo modelo:

```
observado = pigmento · cobertura + fundo · (1 - cobertura)
```

O que muda entre os dois é como se estima a **cobertura**.

## Dois modos, porque são dois problemas

**`aquarela` (padrão) — papel claro por baixo da tinta.**
Uma aquarela é pigmento translúcido *sobre* papel: o que se vê é uma mistura
entre a tinta e o papel. Recortar por semelhança de cor destruiria as aguadas
claras, que são quase papel. A tinta só escurece, então a cobertura sai do canal
que mais escureceu, em proporção à folga que havia até o preto.

**`chapado` — uma cor chapada atrás do desenho.**
Aqui o fundo não está por baixo da tinta, está atrás dela, e o desenho costuma
ser opaco. O escurecimento deixa de servir: **um desenho claro é mais claro que
o fundo, e o modo `aquarela` o apagaria inteiro** — foi o que motivou este modo,
com uma criatura branca sobre verde. A cobertura passa a sair da *distância de
cor* até o fundo, que é o que separa um cinza neutro de um verde de brilho
parecido.

Duas armadilhas que valem saber, porque são visíveis:

- Medir por canal, em vez de por distância, faz um cinza neutro sobre verde
  parecer 40% tinta. Ao descontar 60% de verde, ele volta magenta. É a razão de
  o modo `chapado` não ser só um ajuste do outro.
- Nas bordas sobra matiz do fundo — a franja verde. `--resto` a remove, mas só
  onde a cobertura é parcial: no miolo opaco não há fundo por baixo, e um ocre,
  que legitimamente contém verde, sairia rosa se fosse tratado como franja.

## Duas maneiras de usar

**Na página.** Uma página só, sem servidor: arraste a imagem, mexa nos
controles, veja o antes e o depois lado a lado e grave. A imagem nunca sai do
navegador — não há upload.

**Na linha de comando.** Para lotes e para automação:

```bash
pip install -r requirements.txt
python3 aquarela.py capa.jpg --aparar
python3 aquarela.py capa.jpg --saida hero.png --papel '#fcf9ed' --ganho 1.3
python3 aquarela.py grifo.jpg --modo chapado --tolerancia 20 --suavidade 40 --aparar
```

| opção | modo | o que faz |
|---|---|---|
| `--papel` | ambos | Cor do papel ou do fundo. Sem ela, é a mediana das bordas. |
| `--aparar` | ambos | Corta as margens totalmente transparentes. |
| `--ganho` | aquarela | Multiplica a cobertura. Acima de 1, tinta mais densa. |
| `--limpar` | aquarela | Abaixo desta cobertura o pixel vira transparente puro. |
| `--modo` | — | `aquarela` (padrão) ou `chapado`. |
| `--tolerancia` | chapado | Distância de cor abaixo da qual o pixel é fundo puro. |
| `--suavidade` | chapado | Largura da rampa onde a borda ganha alfa parcial. |
| `--resto` | chapado | Quanto do matiz do fundo tirar das bordas, de 0 a 1. |

## As duas fazem a mesma conta

A página não chama o Python: ela roda uma porta do algoritmo em JavaScript, para
que arrastar um controle responda na hora. Uma porta só vale se for fiel, então
há um teste que passa a mesma imagem pelas duas implementações e compara os
bytes RGBA um a um:

```bash
python3 teste/paridade.py imagem.png --ganho 1.6 --limpar 0.08
python3 teste/paridade.py grifo.jpg --modo chapado --tolerancia 20 --resto 1.0
```

```
papel  python=[254, 247, 236]  js=[254, 247, 236]
IDENTICO: 9142272 bytes conferidos, nenhuma diferenca.
```

O teste precisa do `node` no caminho.

## O que a página tem além da conta

- **Cortina** entre o antes e o depois, arrastável.
- **Fundos de prévia**: xadrez, papel claro, fundo escuro e passe-partout. Serve
  para ver o resultado onde ele vai viver de verdade.
- **Conta-gotas do papel**, para varreduras com moldura ou sombra, onde a
  mediana das bordas erra.
- **Saturação**: separar o pigmento costuma deixar a tinta um pouco mais pálida
  do que parecia; aqui se devolve o que faltou.
- **Corte automático** na caixa do desenho, com limiar e folga. O tracejado
  mostra o que sobra, e o tamanho informado é o que o arquivo terá — medido na
  resolução cheia, não estimado na prévia.
- **Largura de saída** e **WebP**, que com transparência costuma sair em torno
  de metade do PNG.

## Os limites

**Aquarela sobre fundo escuro fica opaca**, porque tinta translúcida precisa de
papel claro por baixo. Não é defeito da ferramenta, é como a tinta funciona — e
por isso a prévia oferece o passe-partout: uma folha de papel atrás da
ilustração, como uma estampa colada na página.

**Uma aguada genuinamente translúcida sobre cor chapada não tem volta exata.**
Medindo contra uma separação de alfa conhecido, recomposta sobre quatro fundos e
separada de novo, o erro médio de cor ficou entre 26 e 57 de 255, e o de alfa
entre 80 e 110. É o esperado: uma equação, duas incógnitas por pixel. O modo
`chapado` funciona bem para desenho opaco sobre fundo chapado, que é o caso
comum; para aguada de verdade, o caminho é gerar sobre papel claro.

Nessa mesma medição o **verde saiu o melhor dos quatro fundos** testados para um
desenho de tons quentes — melhor que azul, magenta e ciano. Contraria a
intuição, mas foi medido.

## Estrutura

```
aquarela.py        linha de comando
site/aquarela.js   o mesmo algoritmo, sem DOM
site/pagina.js     a interface
teste/paridade.py  prova que as duas concordam
```

## Rodar a página localmente

`site/pagina.js` é um módulo, então abrir o arquivo direto pelo `file://` não
funciona — o navegador recusa. Sirva a pasta:

```bash
python3 -m http.server -d site 8000
```
