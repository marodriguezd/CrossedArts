import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown, parseInline, sanitizeUrl } from '../src/lib/markdown/parseMarkdown.ts';
import { MarkdownMessage, MessageBody, SourceTitle } from '../src/components/ai/MarkdownMessage.ts';

const render = (node: any): string => renderToStaticMarkup(node);

test('19.1 Bold: **texto** se renderiza como <strong> y no como asteriscos literales', () => {
  const html = render(createElement(MarkdownMessage, { content: '**Tutor CrossedArts:**' }));
  assert.match(html, /<strong[^>]*>Tutor CrossedArts:<\/strong>/);
  assert.ok(!html.includes('**'), 'No deben quedar asteriscos literales de negrita');
});

test('19.2 Código inline: `code` se renderiza como <code> aislado', () => {
  const html = render(createElement(MarkdownMessage, { content: 'Importa `dao.ts` para acceder.' }));
  assert.match(html, /<code[^>]*>dao\.ts<\/code>/);
});

test('19.3 Listas ordenadas y no ordenadas con elementos <li>', () => {
  const ul = render(createElement(MarkdownMessage, { content: '- uno\n- dos\n- tres' }));
  assert.match(ul, /<ul[^>]*>/);
  assert.strictEqual((ul.match(/<li/g) || []).length, 3);

  const ol = render(createElement(MarkdownMessage, { content: '1. primero\n2. segundo' }));
  assert.match(ol, /<ol[^>]*>/);
  assert.strictEqual((ol.match(/<li/g) || []).length, 2);
});

test('19.4 Los mensajes del usuario permanecen como texto plano sin interpretar Markdown', () => {
  const html = render(
    createElement(MessageBody, { role: 'user', content: '**no negrita** y `no codigo`' })
  );
  assert.ok(html.includes('**no negrita**'), 'Los asteriscos deben conservarse literales');
  assert.ok(html.includes('`no codigo`'), 'Las comillas invertidas deben conservarse literales');
  assert.ok(!html.includes('<strong'), 'El mensaje de usuario no debe generar <strong>');
  assert.ok(!html.includes('<code'), 'El mensaje de usuario no debe generar <code>');
});

test('19.5 HTML/script del asistente nunca se inyecta como HTML ejecutable', () => {
  const html = render(
    createElement(MarkdownMessage, {
      content: '<script>alert("x")</script>\n\n<img src=x onerror="alert(1)">\n\n**sano**'
    })
  );
  assert.ok(!html.includes('<script'), 'No debe aparecer una etiqueta <script> real');
  assert.ok(!html.includes('<img'), 'No debe aparecer una etiqueta <img> real');
  assert.ok(html.includes('&lt;script&gt;'), 'El HTML debe quedar escapado como texto');
  assert.ok(html.includes('&lt;img'), 'El HTML debe quedar escapado como texto');
  assert.ok(html.includes('onerror'), 'El texto sospechoso se muestra inerte como texto');
  assert.match(html, /<strong[^>]*>sano<\/strong>/, 'El Markdown legítimo sí se procesa');
});

test('19.6 Títulos de fuentes RAG quedan fuera del renderizador Markdown', () => {
  const html = render(createElement(SourceTitle, { title: '**Curso** `literal`' }));
  assert.ok(html.includes('**Curso** `literal`'), 'El título debe mostrarse literal');
  assert.ok(!html.includes('<strong'), 'Los títulos no deben renderizar negrita');
  assert.ok(!html.includes('<code'), 'Los títulos no deben renderizar código');
});

test('19.7 Bloques de código largos contienen el scroll horizontal sin desbordar la página', () => {
  const longLine = 'x'.repeat(2000);
  const html = render(createElement(MarkdownMessage, { content: '```\n' + longLine + '\n```' }));
  assert.match(html, /<pre[^>]*overflow-x-auto/, 'El bloque debe tener scroll horizontal');
  assert.match(html, /<pre[^>]*max-w-full/, 'El bloque no debe exceder el ancho del contenedor');
  assert.match(html, /whitespace-pre/, 'El contenido debe preservar su formato');
  assert.ok(html.includes(longLine), 'El contenido íntegro debe conservarse');
});

test('19.8 Respuestas del asistente sin Markdown se renderizan de forma estable como párrafo', () => {
  const html = render(createElement(MarkdownMessage, { content: '¡Hola! Soy tu tutor pedagógico.' }));
  assert.match(html, /<p[^>]*>¡Hola! Soy tu tutor pedagógico\.<\/p>/);
  assert.ok(!html.includes('**'));
});

test('19.9 Saltos de línea simples se convierten en <br>', () => {
  const html = render(createElement(MarkdownMessage, { content: 'línea uno\nlínea dos' }));
  assert.match(html, /línea uno<br\/?>línea dos/);
});

test('19.10 Encabezados presentes se renderizan subordinados (h4/h5/h6)', () => {
  const html = render(createElement(MarkdownMessage, { content: '# Título principal\n\n## Sección' }));
  assert.match(html, /<h4[^>]*>Título principal<\/h4>/);
  assert.match(html, /<h5[^>]*>Sección<\/h5>/);
});

test('19.11 Bloques de código cercados preservan el contenido y el lenguaje', () => {
  const html = render(createElement(MarkdownMessage, { content: '```js\nconst a = 1;\n```' }));
  assert.match(html, /<pre[^>]*>/);
  assert.ok(html.includes('const a = 1;'));
});

test('19.12 Enlaces seguros se renderizan con rel noopener; esquemas peligrosos se descartan', () => {
  const safe = render(createElement(MarkdownMessage, { content: '[docs](https://example.com/guia)' }));
  assert.match(safe, /<a[^>]*href="https:\/\/example\.com\/guia"[^>]*>/);
  assert.match(safe, /rel="noopener noreferrer"/);

  const dangerous = render(createElement(MarkdownMessage, { content: '[peligro](javascript:alert(1))' }));
  assert.ok(!dangerous.includes('javascript:'), 'El esquema javascript: debe eliminarse');
  assert.ok(!dangerous.includes('<a'), 'No debe generarse un anchor inseguro');
  assert.ok(dangerous.includes('peligro'), 'El texto del enlace se conserva plano');
});

test('19.13 sanitizeUrl: allowlist estricta de esquemas y rechazo de URLs con caracteres de control', () => {
  assert.strictEqual(sanitizeUrl('https://example.com'), 'https://example.com');
  assert.strictEqual(sanitizeUrl('mailto:tutor@example.com'), 'mailto:tutor@example.com');
  assert.strictEqual(sanitizeUrl('/ruta/local'), '/ruta/local');
  assert.strictEqual(sanitizeUrl('#ancla'), '#ancla');
  assert.strictEqual(sanitizeUrl('javascript:alert(1)'), null);
  assert.strictEqual(sanitizeUrl('JavaScript:alert(1)'), null);
  assert.strictEqual(sanitizeUrl('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.strictEqual(sanitizeUrl('vbscript:msgbox(1)'), null);
  assert.strictEqual(sanitizeUrl('java\nscript:alert(1)'), null);
  assert.strictEqual(sanitizeUrl('//evil.example.com'), null);
  assert.strictEqual(sanitizeUrl(''), null);
  assert.strictEqual(sanitizeUrl(undefined), null);
});

test('19.14 El AST no contiene ningún nodo de HTML en bruto: el HTML queda como texto', () => {
  const blocks = parseMarkdown('<b>hola</b>\n\n<script>alert(1)</script>');
  const blockTypes = new Set(blocks.map((b: any) => b.type));
  const allowedBlocks = new Set(['paragraph', 'heading', 'list', 'code']);
  for (const type of blockTypes) {
    assert.ok(allowedBlocks.has(type), `Tipo de bloque inesperado: ${type}`);
  }
  assert.ok(!blockTypes.has('html' as any), 'No debe existir un nodo html');

  const inline = parseInline('<b>x</b>');
  assert.deepStrictEqual(inline, [{ type: 'text', value: '<b>x</b>' }]);
});
