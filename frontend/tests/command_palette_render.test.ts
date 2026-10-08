import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandPalette } from '../src/components/common/CommandPalette.ts';
import { buildPaletteCatalog, type PaletteCatalogInput } from '../src/services/commandPalette.ts';

/**
 * Pruebas de RENDER de la paleta, sobre el HTML realmente producido.
 *
 * Estas sustituyen a las auditorías de fuente que solo comprobaban que una cadena
 * apareciera en el archivo. Esa era exactamente la debilidad que dejó pasar seis
 * defectos de accesibilidad: la cadena `aria-controls` estaba, el árbol no.
 *
 * Es posible gracias a una decisión de la Fase 1: `CommandPalette` está escrito en
 * `.ts` con `createElement`, porque `node --test --experimental-strip-types` elimina
 * tipos pero no JSX y por tanto no puede importar un `.tsx`.
 */

interface RenderOptions {
  query?: string;
  items?: PaletteCatalogInput;
}

function render(open: boolean, { query = '', items }: RenderOptions = {}): string {
  return renderToStaticMarkup(
    createElement(CommandPalette, {
      isOpen: open,
      onClose: () => {},
      onExecute: () => {},
      initialQuery: query,
      items: buildPaletteCatalog(items ?? emptyCatalog()),
    })
  );
}

function emptyCatalog(): PaletteCatalogInput {
  return {
    courses: [],
    books: [],
    notes: [],
    lessons: [],
    concepts: [],
    resources: [],
    practiceWork: [],
    pendingReviews: 0,
    continueTarget: null,
    isDarkTheme: false,
  };
}

/** Atributo de una etiqueta del HTML renderizado. */
function attr(html: string, tag: string, name: string): string | null {
  const tagMatch = new RegExp(`<${tag}\\b[^>]*>`).exec(html);
  if (!tagMatch) return null;
  return new RegExp(`${name}="([^"]*)"`).exec(tagMatch[0])?.[1] ?? null;
}

/** Atributo de la PRIMERA etiqueta que declara `attrName="attrValue"`. */
function attrOf(html: string, attrName: string, attrValue: string, name: string): string | null {
  const tag = new RegExp(`<[a-z]+\\b[^>]*${attrName}="${attrValue}"[^>]*>`).exec(html);
  if (!tag) return null;
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag[0])?.[1] ?? null;
}

/**
 * Texto realmente visible para el usuario: sin etiquetas y con las entidades
 * des-escapadas. Es la lectura honesta del HTML: si una nota trae `<script>`, lo
 * que el ojo ve es literalmente `<script>`, no una etiqueta ejecutable.
 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');
}

test('19.27 El diálogo se renderiza con su contrato ARIA real', () => {
  const html = render(true);

  const dialog = /<div[^>]*role="dialog"[^>]*>/.exec(html);
  assert.ok(dialog, 'Debe existir un elemento con role="dialog"');
  assert.ok(html.includes('aria-modal="true"'), 'El diálogo debe ser modal');

  // `aria-labelledby` debe apuntar a un `sr-only` que exista de verdad.
  const labelledBy = attrOf(html, 'role', 'dialog', 'aria-labelledby');
  assert.ok(labelledBy, 'El diálogo debe tener título enlazado');
  assert.ok(
    new RegExp(`id="${labelledBy}"`).test(html),
    `aria-labelledby="${labelledBy}" debe apuntar a un elemento existente`
  );
  assert.ok(html.includes('Paleta de comandos'), 'El diálogo debe tener nombre legible');

  // Patrón combobox completo.
  assert.ok(html.includes('role="combobox"'));
  assert.ok(html.includes('aria-autocomplete="list"'));
  assert.ok(html.includes('role="listbox"'));
  assert.ok(html.includes('role="option"'));
  assert.ok(html.includes('role="group"'), 'Los resultados se agrupan semánticamente');
  assert.ok(html.includes('aria-live="polite"'), 'El número de resultados debe anunciarse');
});

test('19.28 El listbox existe SIEMPRE, aunque no haya nada que mostrar', () => {
  // Este es el defecto 1, y el más grave: con cero resultados `aria-controls`
  // quedaba apuntando a un id inexistente, justo cuando más se necesita leer.
  const html = render(true, { items: emptyCatalog(), query: 'nada de esto existe' });

  const listboxId = attrOf(html, 'role', 'listbox', 'id');
  assert.ok(listboxId, 'El listbox debe montarse incluso sin resultados');

  const controls = attr(html, 'input', 'aria-controls');
  assert.ok(controls, 'El combobox debe declarar aria-controls');
  assert.equal(
    controls,
    listboxId,
    'aria-controls debe apuntar al id REAL del listbox, no a uno inventado'
  );

  // Y el mensaje de vacío existe, pero FUERA del listbox: no son opciones.
  assert.ok(html.includes('Sin resultados'), 'Debe explicarse que no hay resultados');
  const listboxEnd = html.indexOf('</div>', html.indexOf('role="listbox"'));
  assert.ok(
    html.indexOf('Sin resultados') > listboxEnd,
    'El mensaje de vacío no debe ser contenido del listbox'
  );
});

test('19.29 aria-activedescendant apunta a una option que existe', () => {
  const html = render(true, { items: emptyCatalog() });

  const active = attr(html, 'input', 'aria-activedescendant');
  assert.ok(active, 'Debe anunciarse el elemento activo');
  assert.ok(
    html.includes(`id="${active}"`),
    `aria-activedescendant="${active}" debe corresponder a una option existente`
  );
  assert.ok(
    new RegExp(`id="${active}"[^>]*role="option"`).test(html),
    'El elemento activo debe ser una option, no un elemento cualquiera'
  );
});

test('19.30 La paleta se sitúa por encima de cualquier otro overlay', () => {
  const html = render(true);
  // Por encima del cajón IA (z-50) y de ConfirmDialog (z-60).
  assert.ok(html.includes('z-[70]'), 'El overlay debe ir en z-[70]');
});

test('19.31 El resaltado marca el tramo EXACTO, con los acentos intactos', () => {
  const html = render(true, {
    query: 'react',
    items: {
      ...emptyCatalog(),
      lessons: [
        {
          lessonId: 'l1',
          lessonTitle: 'Introducción a React',
          lessonContent: '',
          durationMinutes: 10,
          moduleTitle: 'Base',
          courseId: 'c1',
          courseTitle: 'Curso',
        },
      ],
    },
  });

  // "Introducción" mide 12 caracteres en NFC y 13 en NFD. Si el resaltado se
  // calculara sobre la forma normalizada, el <mark> se desplazaría y partiría la
  // palabra. Aquí el <mark> contiene exactamente "React".
  assert.ok(html.includes('<mark'), 'El resaltado debe usar <mark>');
  assert.ok(html.includes('>React</mark>'), 'El <mark> debe contener el tramo original');

  // El texto completo debe seguir siendo reconstruible: nada se pierde ni se duplica.
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
  assert.ok(text.includes('Introducción a React'), 'La palabra con tilde debe quedar intacta');
});

test('19.32 Un título con HTML se ESCAPA: se muestra, no se interpreta', () => {
  const html = render(true, {
    query: 'script',
    items: {
      ...emptyCatalog(),
      notes: [
        {
          id: 'n1',
          title: '<script>alert(1)</script>',
          content: 'cuerpo con <img src=x onerror=alert(1)>',
          resource_id: null,
          lesson_id: null,
          created_at: '',
          updated_at: '',
          tags: [],
        },
      ],
    },
  });

  // Lo que el usuario lee es el texto original, punto por punto: el <mark> parte
  // la entidad escapada pero el conjunto es idéntico al título real.
  assert.ok(
    visibleText(html).includes('<script>alert(1)</script>'),
    'El título debe mostrarse literal, sin alterar un solo carácter'
  );

  // Y ninguna etiqueta real llega al DOM.
  assert.ok(!/<script[\s>]/i.test(html), 'No puede aparecer una etiqueta script real');
  assert.ok(!/<img[\s>]/i.test(html), 'No puede aparecer una etiqueta img real');

  // `onerror=` sí aparece, pero como TEXTO escapado. Lo que no puede pasar es que
  // viva dentro de una etiqueta, que es donde el navegador lo ejecutaría.
  const etiquetas = html.match(/<[^>]*>/g) ?? [];
  for (const etiqueta of etiquetas) {
    assert.ok(!/onerror/i.test(etiqueta), `Un manejador sobrevivió dentro de una etiqueta: ${etiqueta}`);
  }
});

test('19.33 El fragmento del cuerpo aparece cuando la coincidencia pasa del resumen', () => {
  const filler = 'contenido '.repeat(60);
  const html = render(true, {
    query: 'supermemo',
    items: {
      ...emptyCatalog(),
      lessons: [
        {
          lessonId: 'l1',
          lessonTitle: 'Protocolo de repaso',
          lessonContent: `${filler}y aquí aparece SuperMemo-2 al final del documento`,
          durationMinutes: 5,
          moduleTitle: 'Módulo',
          courseId: 'c1',
          courseTitle: 'Curso',
        },
      ],
    },
  });

  // El término está en el cuerpo, muy lejos del título: sin el nivel `body` la
  // paleta no lo encontraría, y sin el fragmento el usuario no sabría por qué sale.
  assert.ok(html.includes('SuperMemo'), 'Debe mostrarse el fragmento que casó');
  assert.ok(html.includes('…'), 'El fragmento se recorta con elipsis');
  assert.ok(!html.includes(filler), 'El cuerpo entero no debe volverse el subtítulo');
});

test('19.34 El subtítulo de una nota es un resumen, no el cuerpo entero', () => {
  const largo = 'palabra '.repeat(500);
  const html = render(true, {
    items: {
      ...emptyCatalog(),
      notes: [
        {
          id: 'n1',
          title: 'Nota larga',
          content: largo,
          resource_id: null,
          lesson_id: null,
          created_at: '',
          updated_at: '',
          tags: [],
        },
      ],
    },
  });

  // El CSS trunca visualmente, pero el cuerpo entero seguiría siendo miles de nodos
  // de texto en el DOM y taparía además el nivel `body`.
  assert.ok(html.includes('palabra'), 'El resumen debe conservar contenido');
  assert.ok(!html.includes(largo), 'El cuerpo completo no debe estar en el DOM');
});

test('19.35 initialQuery siembra el campo al abrir', () => {
  const html = render(true, { query: 'aulas' });
  const value = attr(html, 'input', 'value');
  assert.equal(value, 'aulas', 'El campo debe abrirse con la consulta inicial');
});

test('19.36 initialQuery es opcional y por defecto abre vacío', () => {
  const html = render(true);
  assert.equal(attr(html, 'input', 'value'), '', 'Sin initialQuery el campo arranca vacío');
});

test('19.37 Cerrada la paleta no renderiza nada', () => {
  const html = render(false);
  assert.equal(html, '', 'Un overlay cerrado no debe dejar nodos en el DOM');
});

test('19.38 El contador announced en singular y en plural', () => {
  const uno = render(true, {
    query: 'Repasar',
    items: emptyCatalog(),
  });
  assert.ok(uno.includes('1 resultado'), 'Debe decir "1 resultado" en singular');
  assert.ok(!uno.includes('1 resultados'), 'Nunca "1 resultados"');

  const varios = render(true, { items: emptyCatalog() });
  // El total se deriva del catálogo real: añadir una acción nueva no debe
  // romper el contador ni obligar a cuadrar un número mágico a mano.
  const esperados = buildPaletteCatalog(emptyCatalog()).length;
  assert.ok(
    varios.includes(`${esperados} resultados`),
    `Debe contar todos los resultados (${esperados})`
  );
});

test('19.39 La leyenda de teclado se renderiza con el estilo del sistema', () => {
  const html = render(true);
  assert.ok(html.includes('<kbd'), 'La leyenda debe usar elementos kbd');
  for (const atajo of ['navegar', 'abrir', 'cerrar']) {
    assert.ok(html.includes(atajo), `Falta la leyenda "${atajo}"`);
  }
});

test('19.40 Sin resultados no hay referencias ARIA colgantes', () => {
  const html = render(true, { query: 'zzzzz', items: emptyCatalog() });

  // Cualquier id referenciado por aria-* debe existir en el documento renderizado.
  const referenciados = [...html.matchAll(/aria-(?:controls|labelledby|activedescendant)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(Boolean);

  for (const id of referenciados) {
    assert.ok(html.includes(`id="${id}"`), `aria-* apunta a "${id}", que no existe`);
  }
});

test('19.41 Ninguna nota puede inyectar etiquetas en el DOM', () => {
  // El <mark> solo puede salir de un hijo de React. Si alguien reintrodujera
  // `dangerouslySetInnerHTML`, este título volvería a ejecutarse; la reconstrucción
  // del texto visible lo detecta sin depender de una auditoría de fuente.
  const titulo = '<img src=x onerror="alert(1)">';
  const html = render(true, {
    query: 'img',
    items: {
      ...emptyCatalog(),
      notes: [
        {
          id: 'n1',
          title: titulo,
          content: '',
          resource_id: null,
          lesson_id: null,
          created_at: '',
          updated_at: '',
          tags: [],
        },
      ],
    },
  });

  assert.ok(!/<img[\s>]/i.test(html), 'Ninguna img real puede aparecer en el DOM');
  assert.ok(visibleText(html).includes(titulo), 'El texto debe conservarse literal');
});

test('19.42 El componente renderiza en el servidor sin tocar el DOM', () => {
  // `renderToStaticMarkup` no ejecuta `useEffect`: si el render tocara `document`
  // o `window` fuera del efecto, esto reventaría. Es la garantía de que la paleta
  // es estructuralmente segura antes de que exista el navegador.
  const el: ReactElement = createElement(CommandPalette, {
    isOpen: true,
    onClose: () => {},
    onExecute: () => {},
    items: buildPaletteCatalog(emptyCatalog()),
  });
  assert.doesNotThrow(() => renderToStaticMarkup(el));
});

test('19.43 Un recurso importado se renderiza con su grupo y su icono', () => {
  // El grupo nuevo obliga a tocar `GROUP_ICONS`: sin entrada ahí, el icono sería
  // `undefined` y React reventaría al renderizar. Esta prueba lo cubre de verdad.
  const html = render(true, {
    query: 'supermemo',
    items: {
      ...emptyCatalog(),
      resources: [
        {
          resourceId: 'r1',
          resourceTitle: 'Repetición espaciada',
          resourceDescription: 'El algoritmo SuperMemo-2 en detalle',
          resourceCategory: 'Aprendizaje',
          resourceType: 'pdf',
        },
      ],
    },
  });

  assert.ok(html.includes('Repetición'), 'El recurso debe mostrarse');
  // La consulta casó con el CUERPO, así que el subtítulo muestra el fragmento que
  // explica el resultado, no la categoría. Es el comportamiento correcto.
  assert.ok(html.includes('SuperMemo'), 'El subtítulo debe ser el fragmento que casó');

  // El grupo se anuncia con su etiqueta y es un `group` de verdad.
  assert.ok(html.includes('aria-label="Recursos"'), 'El grupo debe anunciarse como "Recursos"');
  assert.ok(html.includes('Recursos'), 'Y tener su rótulo visible');

  // Icono presente: un icono real de lucide, no un hueco.
  assert.ok(html.includes('lucide-file-down'), 'El grupo recurso necesita su icono en el mapa');
});

test('19.44 Ningun grupo se queda sin nombre accesible', () => {
  // Los rótulos visibles se ocultan al lector de pantalla porque el
  // `role="group"` ya los lleva en `aria-label`. Ninguno debe quedarse mudo.
  const html = render(true, {
    query: 'repetición',
    items: {
      ...emptyCatalog(),
      resources: [
        {
          resourceId: 'r1',
          resourceTitle: 'Repetición espaciada',
          resourceDescription: 'detalle',
          resourceType: 'pdf',
        },
      ],
      notes: [
        {
          id: 'n1',
          title: 'Repetición y olvido',
          content: 'cuerpo',
          resource_id: null,
          lesson_id: null,
          created_at: '',
          updated_at: '',
          tags: [],
        },
      ],
    },
  });

  const grupos = [...html.matchAll(/role="group" aria-label="([^"]*)"/g)].map(m => m[1]);
  assert.ok(grupos.length >= 2, 'Debe aparecer más de un grupo');
  for (const g of grupos) {
    assert.ok(g.trim().length > 0, 'Ningún grupo puede quedarse sin nombre accesible');
  }
});
