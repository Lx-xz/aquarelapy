/**
 * Roda o núcleo JS sobre um despejo cru de pixels e grava o resultado cru.
 * Serve ao teste de paridade: evita precisar de um decodificador de PNG aqui.
 *
 *   node teste/nucleo.mjs <entrada.raw> <largura> <altura> <saida.raw> <opcoes-json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { estimarPapel, separar } from '../site/aquarela.js';

const [, , caminho, l, a, saida, opcoesJson] = process.argv;
const largura = Number(l);
const altura = Number(a);
const dados = new Uint8ClampedArray(readFileSync(caminho));
const opcoes = JSON.parse(opcoesJson);

const papel = opcoes.papel ?? estimarPapel(dados, largura, altura);
const { rgba, estatisticas } = separar(dados, largura, altura, { ...opcoes, papel });

writeFileSync(saida, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length));
console.log(JSON.stringify({
  papel: papel.map((c) => Math.round(c)),
  transparente: +estatisticas.transparente.toFixed(4),
  aguada: +estatisticas.aguada.toFixed(4),
  opaco: +estatisticas.opaco.toFixed(4),
}));
