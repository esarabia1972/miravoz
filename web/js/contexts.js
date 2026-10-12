// contexts.js — Un único contexto de selección para tablero, diálogos y superposiciones (M03, 11/10/2026)
//
// Antes cada componente reemplazaba por su cuenta los objetivos del dwell y del barrido (la página web,
// el render del tablero, la sincronización…) y un diálogo abierto podía dejar activo el tablero de abajo.
// Ahora hay una PILA de contextos:
//  - abajo de todo, el contexto base (tablero o inicio): sus objetivos los informa boards.js al dibujar;
//  - encima, diálogos (alertas, confirmaciones, página web, resultados del benchmark): solo el de arriba
//    ofrece objetivos, y sus botones "Aceptar / Cancelar / Volver / Cerrar" se pueden activar con la mirada
//    o el barrido (nunca hace falta tocar la pantalla para salir de algo que se abrió con la mirada);
//  - paneles del acompañante (configuración, usuarios, importar, editar una celda): pausan la selección.
// Si el tablero se vuelve a dibujar con un diálogo abierto (sync, resize), sus objetivos se GUARDAN pero no
// se activan. Al cerrar, los objetivos se reconstruyen desde el estado actual (nunca nodos eliminados) y se
// reinicia la permanencia, para que el control que quedó debajo no se active solo.
// Se aceptan diálogos anidados (pila); cerrar uno vuelve al anterior.

export class SelectionContexts {
    /**
     * @param {Object} o
     * @param {(targets:Array, info:{name:string, companion:boolean, depth:number}) => void} o.apply  aplica objetivos (dwell + barrido)
     * @param {() => Array} [o.baseTargets]  objetivos actuales del tablero/inicio (se leen al restaurar)
     * @param {(blocked:boolean, top:object|null) => void} [o.onChange]  p. ej. marcar inert el fondo y reiniciar la permanencia
     */
    constructor({ apply = () => {}, baseTargets = () => [], onChange = () => {} } = {}) {
        this.applyFn = apply;
        this.baseTargetsFn = baseTargets;
        this.onChange = onChange;
        this.stack = [];
        this.base = [];
        this.seq = 0;
    }

    configure({ apply, baseTargets, onChange } = {}) {
        if (apply) this.applyFn = apply;
        if (baseTargets) this.baseTargetsFn = baseTargets;
        if (onChange) this.onChange = onChange;
    }

    top() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
    /** ¿Hay algo encima del tablero? */
    isBlocked() { return this.stack.length > 0; }
    /** ¿Un panel del acompañante pausa la selección? */
    isPaused() { const t = this.top(); return !!t && t.companion; }

    /**
     * Abre un contexto. getTargets() se evalúa al activarlo (y de nuevo si vuelve a quedar arriba).
     * @returns token para cerrarlo
     */
    push(name, getTargets = () => [], { companion = false, element = null } = {}) {
        const ctx = { id: ++this.seq, name, getTargets, companion, element };
        this.stack.push(ctx);
        this._activate();
        return ctx.id;
    }

    /** Cierra el contexto del token (si no está arriba, igual se saca de la pila). */
    pop(token) {
        const i = this.stack.findIndex(c => c.id === token);
        if (i < 0) return false;
        const wasTop = i === this.stack.length - 1;
        this.stack.splice(i, 1);
        if (wasTop) this._activate();
        return true;
    }

    /** Sus objetivos cambiaron (0.7.5): se vuelven a leer, solo si está arriba (no cambia el orden de la pila). */
    refresh(token) {
        const top = this.top();
        if (top && top.id === token) this._activate();
    }

    /** ¿Hay un contexto con ese nombre? */
    has(name) { return this.stack.some(c => c.name === name); }

    /** El tablero o el inicio informan sus objetivos (al dibujarse). Con algo encima, solo se guardan. */
    setBase(targets) {
        this.base = targets || [];
        if (!this.isBlocked()) this.applyFn(this.base, { name: 'base', companion: false, depth: 0 });
    }

    _activate() {
        const top = this.top();
        if (top) {
            const targets = top.companion ? [] : (top.getTargets() || []).filter(t => t && t.element && t.element.isConnected !== false);
            this.applyFn(targets, { name: top.name, companion: top.companion, depth: this.stack.length });
        } else {
            // Reconstruir desde el estado actual: los nodos guardados pueden ya no existir
            const fresh = this.baseTargetsFn();
            this.base = Array.isArray(fresh) && fresh.length ? fresh : this.base.filter(t => t && t.element && t.element.isConnected !== false);
            this.applyFn(this.base, { name: 'base', companion: false, depth: 0 });
        }
        this.onChange(this.isBlocked(), top);
    }
}

/** Instancia única de la app (ui.js, media.js, benchmark.js y main.js la comparten). */
export const selectionContexts = new SelectionContexts();

/** Agrega la barra de progreso del dwell a un botón de diálogo (para que se vea el avance). */
export function ensureProgressBar(btn) {
    if (!btn || typeof document === 'undefined' || btn.querySelector('.progress-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'progress-bar';
    btn.appendChild(bar);
    if (!btn.style.position) btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
}

/** Objetivos de dwell/barrido para una lista de botones visibles. */
export function buttonTargets(buttons) {
    return buttons.filter(b => b && !b.hidden && b.style.display !== 'none')
        .map(b => { ensureProgressBar(b); return { element: b, data: null, isAccBtn: true }; });
}
