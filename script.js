// Constantes de configuración de la interfaz
const LIMITE_CARACTERES = 500;
const PAUSA_MINIMA_MS = 1500;
const TIEMPO_LIMITE_MS = 30000;
const CLAVE_STORAGE_SESION = "agente_recomendaciones_session_id";

// Referencias a los elementos del DOM
const zonaDeChat = document.getElementById("zona-de-chat");
const formularioChat = document.getElementById("formulario-chat");
const entradaMensaje = document.getElementById("entrada-mensaje");
const botonEnviar = document.getElementById("boton-enviar");
const contadorCaracteres = document.getElementById("contador-caracteres");
const estadoConexion = document.getElementById("estado-conexion");

// Variables de estado en memoria
let sessionIdMemoria = null;
let enviandoPeticion = false;
let ultimoEnvioTimestamp = 0;

/**
 * Obtiene o crea un sessionId único para mantener la conversación en Make.
 */
function obtenerSessionId() {
    const generarId = () => {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return `ses-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    };

    try {
        let idGuardado = localStorage.getItem(CLAVE_STORAGE_SESION);
        if (!idGuardado) {
            idGuardado = generarId();
            localStorage.setItem(CLAVE_STORAGE_SESION, idGuardado);
        }
        return idGuardado;
    } catch (error) {
        if (!sessionIdMemoria) {
            sessionIdMemoria = generarId();
        }
        return sessionIdMemoria;
    }
}

const sessionId = obtenerSessionId();

/**
 * Agrega una burbuja de mensaje en la zona de chat usando exclusivamente textContent.
 */
function agregarBurbujaChat(texto, tipo, autor = "") {
    const contenedorMensaje = document.createElement("div");
    contenedorMensaje.classList.add("mensaje", `mensaje-${tipo}`);

    if (autor) {
        const etiquetaAutor = document.createElement("span");
        etiquetaAutor.classList.add("autor-mensaje");
        etiquetaAutor.textContent = autor;
        contenedorMensaje.appendChild(etiquetaAutor);
    }

    const parrafoTexto = document.createElement("p");
    parrafoTexto.classList.add("texto-mensaje");
    parrafoTexto.textContent = texto;
    contenedorMensaje.appendChild(parrafoTexto);

    zonaDeChat.appendChild(contenedorMensaje);
    zonaDeChat.scrollTop = zonaDeChat.scrollHeight;

    return contenedorMensaje;
}

/**
 * Habilita o deshabilita los controles de escritura y envío.
 */
function alternarControles(bloqueado) {
    entradaMensaje.disabled = bloqueado;
    botonEnviar.disabled = bloqueado;
    estadoConexion.textContent = bloqueado ? "Esperando respuesta..." : "";
}

/**
 * Extrae el texto válido según el contrato de prioridades del webhook.
 */
function procesarRespuestaServidor(textoCrudo) {
    if (!textoCrudo || textoCrudo.trim() === "") {
        return { texto: "(respuesta vacía)", tipo: "agente" };
    }

    try {
        const datos = JSON.parse(textoCrudo);
        if (datos !== null && typeof datos === "object" && !Array.isArray(datos)) {
            const clavesPrioridad = ["response", "respuesta", "message", "mensaje"];
            for (const clave of clavesPrioridad) {
                if (typeof datos[clave] === "string" && datos[clave].trim() !== "") {
                    return { texto: datos[clave], tipo: "agente" };
                }
            }
            return { texto: "Make respondió, pero sin el campo response", tipo: "aviso" };
        }
        return { texto: textoCrudo, tipo: "agente" };
    } catch (errorParseo) {
        // Si no es JSON válido, devolver el texto tal cual (ej: "Accepted")
        return { texto: textoCrudo, tipo: "agente" };
    }
}

/**
 * Envía el mensaje al webhook configurado en config.js.
 */
async function enviarMensajeAlAgente(mensajeUsuario) {
    // Validación de URL de webhook configurada
    if (typeof WEBHOOK_URL === "undefined" || !WEBHOOK_URL || WEBHOOK_URL.trim() === "" || WEBHOOK_URL.includes("ACA VA")) {
        agregarBurbujaChat("Falta pegar la URL de tu webhook en config.js", "aviso", "Aviso del sistema");
        return;
    }

    enviandoPeticion = true;
    alternarControles(true);

    const burbujaCargando = agregarBurbujaChat("Buscando recomendaciones...", "cargando", "Agente de series, películas y libros");
    burbujaCargando.classList.add("mensaje-agente");

    const controladorAbort = new AbortController();
    const temporizadorTimeout = setTimeout(() => controladorAbort.abort(), TIEMPO_LIMITE_MS);

    const payload = {
        sessionId: sessionId,
        mensaje: mensajeUsuario,
        fecha: new Date().toISOString()
    };

    try {
        const respuesta = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: controladorAbort.signal
        });

        const textoRespuesta = await respuesta.text();
        burbujaCargando.remove();

        if (!respuesta.ok) {
            agregarBurbujaChat(
                `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
                "error",
                "Error de conexión"
            );
            return;
        }

        const resultado = procesarRespuestaServidor(textoRespuesta);
        agregarBurbujaChat(resultado.texto, resultado.tipo, "Agente de series, películas y libros");

    } catch (error) {
        burbujaCargando.remove();
        if (error.name === "AbortError") {
            agregarBurbujaChat(
                "La solicitud tardó demasiado y se canceló (tiempo límite de 30 segundos agotado).",
                "error",
                "Tiempo agotado"
            );
        } else {
            agregarBurbujaChat(
                "No se pudo conectar con el servidor. Verificá tu conexión a internet o la URL del webhook.",
                "error",
                "Error de red"
            );
        }
    } finally {
        clearTimeout(temporizadorTimeout);
        ultimoEnvioTimestamp = Date.now();
        enviandoPeticion = false;
        alternarControles(false);
        entradaMensaje.focus();
    }
}

/**
 * Maneja el envío del formulario validando longitud y pausa mínima.
 */
function manejarEnvioFormulario(evento) {
    evento.preventDefault();

    if (enviandoPeticion) return;

    const ahora = Date.now();
    if (ahora - ultimoEnvioTimestamp < PAUSA_MINIMA_MS) {
        estadoConexion.textContent = "Esperá un momento antes de enviar otro mensaje.";
        return;
    }

    const texto = entradaMensaje.value.trim();
    if (texto.length === 0) return;

    if (texto.length > LIMITE_CARACTERES) {
        agregarBurbujaChat(`El mensaje supera el límite máximo de ${LIMITE_CARACTERES} caracteres.`, "aviso", "Aviso");
        return;
    }

    agregarBurbujaChat(texto, "usuario", "Vos");
    entradaMensaje.value = "";
    actualizarContador();

    enviarMensajeAlAgente(texto);
}

/**
 * Actualiza el contador de caracteres en tiempo real.
 */
function actualizarContador() {
    const longitudActual = entradaMensaje.value.length;
    contadorCaracteres.textContent = `${longitudActual} / ${LIMITE_CARACTERES}`;
}

// Eventos de interfaz
formularioChat.addEventListener("submit", manejarEnvioFormulario);
entradaMensaje.addEventListener("input", actualizarContador);

// Permitir enviar con Enter (sin Shift)
entradaMensaje.addEventListener("keydown", (evento) => {
    if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        formularioChat.requestSubmit();
    }
});
