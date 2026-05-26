const API_URL = "http://localhost:8080/api"; // Ajusta al puerto de tu backend si es necesario

// ==========================================
// 1. SEGURIDAD GLOBAL Y DEPURACIÓN
// ==========================================

// Función para obtener el token siempre actualizado de localStorage
function getToken() {
    return localStorage.getItem("jwt_token");
}

// 🛠️ NUEVO: Función para decodificar el token y ver qué tiene por dentro
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

// 🛠️ NUEVO: Función para auditar el tiempo del token vs tu PC
function auditarToken() {
    const token = getToken();
    if (!token) {
        console.warn("⚠️ AUDITORÍA: No hay token en el localStorage.");
        return;
    }

    const payload = parseJwt(token);
    if (!payload) {
        console.error("❌ AUDITORÍA: El token guardado no tiene un formato válido.");
        return;
    }

    // Multiplicamos por 1000 porque JWT usa segundos y JS usa milisegundos
    const fechaCreacion = new Date(payload.iat * 1000);
    const fechaExpiracion = new Date(payload.exp * 1000);
    const horaActual = new Date();

    console.log("====== 🕵️ AUDITORÍA DE TIEMPO DEL TOKEN ======");
    console.log("👤 Usuario del token:", payload.sub);
    console.log("🟢 Token Creado el:   ", fechaCreacion.toLocaleString());
    console.log("🔴 Token Expira el:   ", fechaExpiracion.toLocaleString());
    console.log("💻 Hora actual del PC:", horaActual.toLocaleString());

    if (horaActual > fechaExpiracion) {
        console.error("🚨 CONCLUSIÓN: ¡EL TOKEN ESTÁ EXPIRADO según el reloj de tu PC!");
    } else if (horaActual < fechaCreacion) {
        console.error("🚨 CONCLUSIÓN: ¡VIAJE EN EL TIEMPO! El token dice haber sido creado en el futuro. (Tu PC o el Servidor tienen la hora mal).");
    } else {
        console.log("✅ CONCLUSIÓN: El token está vigente y sano.");
    }
    console.log("==============================================");
}

// Si el HTML tiene data-auth="true" y no hay token, lo echamos al login
if (document.body.getAttribute("data-auth") === "true" && !getToken()) {
    window.location.href = "/static/login.html";
}

// Configuración dinámica para fetch con Token
function getAuthHeaders() {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getToken()}`
    };
}

// Cerrar sesión global
const btnLogout = document.getElementById("btnLogout");
if (btnLogout) {
    btnLogout.addEventListener("click", () => {
        localStorage.removeItem("jwt_token");
        window.location.href = "/static/login.html";
    });
}

// ==========================================
// 2. LÓGICA POR PÁGINA (Ruteo simple)
// ==========================================
const currentPath = window.location.pathname;

// --- LOGIN ---
if (currentPath.includes("login.html") || currentPath === "/static/login" || currentPath === "/static/") {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("email").value;
            const password = document.getElementById("password").value;
            const msgEl = document.getElementById("loginMsg");
            msgEl.textContent = "Validando...";

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, password })
                });

                if (response.ok) {
                    const data = await response.json();
                    localStorage.setItem("jwt_token", data.token);
                    console.log("🔑 Nuevo token guardado desde el Login.");
                    window.location.href = "/static/dashboard.html";
                } else {
                    msgEl.style.color = "red";
                    msgEl.textContent = "Credenciales incorrectas.";
                }
            } catch (error) {
                msgEl.textContent = "Error de conexión con el servidor.";
            }
        });
    }
}

// --- MÓDULO: DONANTES Y FIRMAS INTEGRADO ---
if (currentPath.includes("donantes.html")) {

    // --- 1. LÓGICA DE LA TABLA ---
    async function cargarDonantes() {
        try {
            const res = await fetch(`${API_URL}/donantes?page=0&size=50`, { headers: getAuthHeaders() });
            if (res.ok) {
                const data = await res.json();
                const tbody = document.getElementById("tablaDonantesBody");
                tbody.innerHTML = "";
                const listaDonantes = data.content ? data.content : data;

                listaDonantes.forEach(d => {
                    const sangreVisual = (d.tipoSangre || "NO REGISTRADO").replace('_', ' ');
                    tbody.innerHTML += `
                        <tr>
                            <td>${d.id || '-'}</td>
                            <td><strong>${d.documento}</strong></td>
                            <td>${d.nombreCompleto || (d.nombres + ' ' + d.apellidos)}</td>
                            <td><span class="badge badge-blood">${sangreVisual}</span></td>
                            <td>${d.telefono || '-'}</td>
                        </tr>
                    `;
                });
            }
        } catch (error) {
            console.error("Error al cargar donantes", error);
        }
    }
    cargarDonantes();

    // --- 2. LÓGICA DEL CANVAS DE FIRMA ---
    const btnDibujar = document.getElementById("btnFirmaDibujar");
    const btnSubir = document.getElementById("btnFirmaSubir");
    const wrapperCanvas = document.getElementById("wrapperCanvas");
    const wrapperArchivo = document.getElementById("wrapperArchivo");
    let modoFirma = "dibujar";

    btnDibujar.addEventListener("click", () => {
        modoFirma = "dibujar";
        btnDibujar.classList.add("active"); btnSubir.classList.remove("active");
        wrapperCanvas.style.display = "block"; wrapperArchivo.style.display = "none";
    });

    btnSubir.addEventListener("click", () => {
        modoFirma = "subir";
        btnSubir.classList.add("active"); btnDibujar.classList.remove("active");
        wrapperArchivo.style.display = "block"; wrapperCanvas.style.display = "none";
    });

    const canvas = document.getElementById("canvasFirma");
    const ctx = canvas.getContext("2d");
    let dibujando = false;
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    canvas.addEventListener("mousedown", (e) => { dibujando = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); });
    canvas.addEventListener("mousemove", (e) => { if (dibujando) { const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); } });
    canvas.addEventListener("mouseup", () => dibujando = false);
    document.getElementById("btnClearCanvas").addEventListener("click", () => ctx.clearRect(0, 0, canvas.width, canvas.height));

    function canvasToFile(canvas, filename) {
        return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], filename, { type: "image/png" })), "image/png"));
    }

    // --- 3. DOBLE GUARDADO: DONANTE + FIRMA ---
    const donanteForm = document.getElementById("donanteForm");
    if (donanteForm) {
        donanteForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const msgEl = document.getElementById("donanteMsg");
            msgEl.textContent = "Guardando Donante...";
            msgEl.style.color = "var(--text-dark)";

            auditarToken();

            // PASO A: Preparar datos del donante
            const payloadDonante = {
                nombre: document.getElementById("nombre").value,
                apellido: document.getElementById("apellido").value,
                documento: document.getElementById("documento").value,
                fechaNacimiento: document.getElementById("fechaNacimiento").value,
                tipoSangre: document.getElementById("tipoSangre").value,
                peso: parseFloat(document.getElementById("peso").value),
                telefono: document.getElementById("telefono").value,
                correo: document.getElementById("correo").value,
                direccion: document.getElementById("direccion").value
            };

            try {
                // PASO B: Guardar Donante en la API
                const resDonante = await fetch(`${API_URL}/donantes`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payloadDonante)
                });

                if (!resDonante.ok) {
                    const errText = await resDonante.text();
                    throw new Error("Error al crear el donante: " + errText);
                }

                const donanteGuardado = await resDonante.json();
                console.log("Respuesta del backend (Donante):", donanteGuardado); // <-- Para ver qué llega realmente

                // Validamos múltiples nombres posibles del ID por si en tu Java se llama diferente
                const nuevoDonanteId = donanteGuardado.id || donanteGuardado.idDonante || donanteGuardado.codigo;

                if (!nuevoDonanteId) {
                    throw new Error("El donante se creó, pero el backend no devolvió un ID válido.");
                }

                msgEl.textContent = "Donante guardado (ID: " + nuevoDonanteId + "). Registrando firma...";

                // PASO C: Preparar archivo de firma
                const formData = new FormData();
                formData.append("donanteId", nuevoDonanteId);
                formData.append("acepta", true);

                const hoy = new Date().toISOString().split('T')[0];
                formData.append("fechaFirma", hoy);

                if (modoFirma === "subir") {
                    const fileInput = document.getElementById("archivoFirma");
                    if (fileInput.files.length === 0) throw new Error("Falta subir el archivo de firma");
                    formData.append("archivoFirma", fileInput.files[0]);
                } else {
                    const archivoFirmaCanvas = await canvasToFile(canvas, `firma_${nuevoDonanteId}.png`);
                    formData.append("archivoFirma", archivoFirmaCanvas);
                }

                const resFirma = await fetch(`${API_URL}/consentimientos`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${getToken()}` },
                    body: formData
                });

                if (!resFirma.ok) {
                    const errorMsg = await resFirma.text();
                    throw new Error("La firma se envió, pero el servidor respondió: " + errorMsg);
                }

                msgEl.style.color = "green";
                msgEl.textContent = "¡Donante y Firma registrados con éxito!";
                donanteForm.reset();
                ctx.clearRect(0, 0, canvas.width, canvas.height);

            } catch (error) {
                console.error(error);
                msgEl.style.color = "red";
                msgEl.textContent = error.message;
            }
        });
    }

    // --- 4. REGISTRO DE DONACIÓN (Suma al inventario automáticamente) ---
    const donacionForm = document.getElementById("donacionForm");
    if (donacionForm) {
        donacionForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const msgEl = document.getElementById("donacionMsg");
            msgEl.textContent = "Procesando...";

            const payloadDonacion = {
                donanteId: parseInt(document.getElementById("donacionDonanteId").value),
                cantidadML: parseFloat(document.getElementById("donacionCantidad").value),
                observaciones: document.getElementById("donacionObs").value
            };

            try {
                const response = await fetch(`${API_URL}/donaciones`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payloadDonacion)
                });

                if (response.ok) {
                    msgEl.style.color = "green";
                    msgEl.textContent = "¡Sangre extraída y enviada al banco!";
                    donacionForm.reset();
                } else {
                    const err = await response.json();
                    msgEl.style.color = "red";
                    msgEl.textContent = err.error || "Error al registrar donación.";
                }
            } catch (error) {
                msgEl.style.color = "red";
                msgEl.textContent = "Error de conexión.";
            }
        });
    }
}

// --- MÓDULO: INVENTARIO ---
if (currentPath.includes("inventario.html")) {
    async function cargarInventario() {
        const grid = document.getElementById("gridInventario");
        try {
            const res = await fetch(`${API_URL}/inventario`, {
                headers: getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                grid.innerHTML = "";

                if (data.length === 0) {
                    grid.innerHTML = "<p>El inventario está vacío.</p>";
                    return;
                }

                data.forEach(item => {
                    let tipoVisual = (item.tipoSangre || "DESC")
                        .replace("POSITIVO", "+")
                        .replace("NEGATIVO", "-")
                        .replace("_", "");

                    grid.innerHTML += `
                        <div class="blood-card">
                            <div class="blood-type">${tipoVisual}</div>
                            <div class="blood-amount">${item.cantidadSangre || item.cantidadML} <small>ML</small></div>
                            <div class="blood-label">Disponible</div>
                        </div>
                    `;
                });
            }
        } catch (error) {
            grid.innerHTML = "<p style='color:red;'>Error al cargar el inventario.</p>";
        }
    }
    cargarInventario();
}

// --- MÓDULO: CONSENTIMIENTO ---
if (currentPath.includes("consentimiento.html")) {
    const consentimientoForm = document.getElementById("consentimientoForm");

    if (consentimientoForm) {
        const btnDibujar = document.getElementById("btnFirmaDibujar");
        const btnSubir = document.getElementById("btnFirmaSubir");
        const wrapperCanvas = document.getElementById("wrapperCanvas");
        const wrapperArchivo = document.getElementById("wrapperArchivo");
        let modoFirma = "dibujar";

        btnDibujar.addEventListener("click", () => {
            modoFirma = "dibujar";
            btnDibujar.classList.add("active"); btnSubir.classList.remove("active");
            wrapperCanvas.style.display = "block"; wrapperArchivo.style.display = "none";
        });

        btnSubir.addEventListener("click", () => {
            modoFirma = "subir";
            btnSubir.classList.add("active"); btnDibujar.classList.remove("active");
            wrapperArchivo.style.display = "block"; wrapperCanvas.style.display = "none";
        });

        const canvas = document.getElementById("canvasFirma");
        const ctx = canvas.getContext("2d");
        let dibujando = false;
        ctx.strokeStyle = "#000"; ctx.lineWidth = 2;

        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: clientX - rect.left, y: clientY - rect.top };
        }

        canvas.addEventListener("mousedown", (e) => { dibujando = true; const pos = getPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); });
        canvas.addEventListener("mousemove", (e) => { if (dibujando) { const pos = getPos(e); ctx.lineTo(pos.x, pos.y); ctx.stroke(); } });
        canvas.addEventListener("mouseup", () => dibujando = false);
        document.getElementById("btnClearCanvas").addEventListener("click", () => ctx.clearRect(0, 0, canvas.width, canvas.height));

        function canvasToFile(canvas, filename) {
            return new Promise((resolve) => canvas.toBlob((blob) => resolve(new File([blob], filename, { type: "image/png" })), "image/png"));
        }

        consentimientoForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const msgEl = document.getElementById("consentMsg");
            msgEl.textContent = "Procesando...";

            // 🛠️ EJECUTAR LA AUDITORÍA ANTES DE ENVIAR
            auditarToken();

            const formData = new FormData();
            formData.append("donanteId", document.getElementById("donanteId").value);
            formData.append("acepta", true);
            formData.append("fechaFirma", document.getElementById("fechaFirma").value);

            if (modoFirma === "subir") {
                const fileInput = document.getElementById("archivoFirma");
                if (fileInput.files.length === 0) return msgEl.textContent = "Sube un archivo.";
                formData.append("archivoFirma", fileInput.files[0]);
            } else {
                const archivoFirmaCanvas = await canvasToFile(canvas, "firma.png");
                formData.append("archivoFirma", archivoFirmaCanvas);
            }

            try {
                const response = await fetch(`${API_URL}/consentimientos`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${getToken()}` },
                    body: formData
                });

                if (response.status === 403) {
                    msgEl.style.color = "red";
                    msgEl.textContent = "Error 403: Sesión expirada. Revisa la consola.";
                    return;
                }

                if (response.ok) {
                    msgEl.style.color = "green"; msgEl.textContent = "Consentimiento registrado.";
                    consentimientoForm.reset(); ctx.clearRect(0, 0, canvas.width, canvas.height);
                } else {
                    const err = await response.json();
                    msgEl.style.color = "red"; msgEl.textContent = err.error || err.message || "Error al guardar.";
                }
            } catch (error) {
                msgEl.style.color = "red";
                msgEl.textContent = "Error de conexión.";
            }
        });
    }
}

// ==========================================
// --- MÓDULO: DONACIONES (EXTRACCIONES) ---
// ==========================================
if (currentPath.includes("donaciones.html")) {

    // Variable temporal para guardar el ID del donante verificado
    let donanteSeleccionadoId = null;

    // 1. Cargar el historial en la tabla (Se mantiene igual)
    async function cargarHistorial() {
        try {
            const res = await fetch(`${API_URL}/donaciones`, { headers: getAuthHeaders() });
            if (res.ok) {
                const donaciones = await res.json();
                const tbody = document.getElementById("tablaDonacionesBody");
                tbody.innerHTML = "";

                if (donaciones.length === 0) {
                    tbody.innerHTML = "<tr><td colspan='4' style='text-align: center;'>No hay donaciones registradas aún.</td></tr>";
                    return;
                }

                donaciones.forEach(d => {
                    tbody.innerHTML += `
                        <tr>
                            <td><strong>${d.codigoDonacion}</strong></td>
                            <td>${d.nombreDonante} (ID: ${d.donanteId})</td>
                            <td><span class="badge badge-blood">${d.cantidadML} ML</span></td>
                            <td>${d.fechaDonacion}</td>
                        </tr>
                    `;
                });
            }
        } catch (error) {
            console.error("Error al cargar historial:", error);
        }
    }
    cargarHistorial();

    // 2. BUSCADOR EN TIEMPO REAL POR DOCUMENTO
    const btnBuscar = document.getElementById("btnBuscarDonante");
    const inputDocumento = document.getElementById("donacionDocumento");
    const txtConfirmacion = document.getElementById("donanteConfirmacion");
    const btnGuardar = document.getElementById("btnGuardarDonacion");

    async function buscarDonantePorDocumento() {
        const documento = inputDocumento.value.trim();
        if (!documento) return;

        txtConfirmacion.textContent = "Buscando...";
        txtConfirmacion.style.color = "var(--text-muted)";
        donanteSeleccionadoId = null;
        btnGuardar.disabled = true;

        try {
            // Consumimos tu endpoint del back que busca por documento
            const res = await fetch(`${API_URL}/donantes/documento/${documento}`, {
                headers: getAuthHeaders()
            });

            if (res.ok) {
                const donante = await res.json();
                donanteSeleccionadoId = donante.id; // Guardamos el ID internamente

                // Mostramos el nombre completo y el tipo de sangre para confirmación médica
                const sangreVisual = (donante.tipoSangre || "").replace('_', ' ');
                txtConfirmacion.innerHTML = `<i class="fa-solid fa-circle-check"></i> Donante: <strong>${donante.nombreCompleto || (donante.nombre + ' ' + donante.apellido)}</strong> (${sangreVisual})`;
                txtConfirmacion.style.color = "green";

                btnGuardar.disabled = false; // Habilitamos el botón de guardar
            } else {
                txtConfirmacion.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Donante no encontrado. Regístralo primero.`;
                txtConfirmacion.style.color = "red";
            }
        } catch (error) {
            console.error("Error al buscar donante:", error);
            txtConfirmacion.textContent = "Error de conexión al verificar el documento.";
            txtConfirmacion.style.color = "red";
        }
    }

    // Buscar al presionar el botón de la lupa
    btnBuscar.addEventListener("click", buscarDonantePorDocumento);

    // Buscar también de forma automática si el usuario presiona "Enter" en el input
    inputDocumento.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            buscarDonantePorDocumento();
        }
    });


    // 3. Formulario para guardar la donación usando el ID capturado
    const donacionForm = document.getElementById("donacionForm");
    if (donacionForm) {
        donacionForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            // Doble validación de seguridad
            if (!donanteSeleccionadoId) {
                alert("Por favor, busca y valida el documento del donante primero.");
                return;
            }

            const msgEl = document.getElementById("donacionMsg");
            msgEl.textContent = "Procesando extracción...";
            msgEl.style.color = "var(--text-dark)";

            auditarToken();

            const payloadDonacion = {
                donanteId: donanteSeleccionadoId, // Le enviamos el ID correcto al backend
                cantidadML: parseFloat(document.getElementById("donacionCantidad").value),
                observaciones: document.getElementById("donacionObs").value
            };

            try {
                const response = await fetch(`${API_URL}/donaciones`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify(payloadDonacion)
                });

                if (response.ok) {
                    msgEl.style.color = "green";
                    msgEl.textContent = "¡Extracción guardada con éxito! Inventario actualizado.";

                    // Resetear formulario y variables
                    donacionForm.reset();
                    txtConfirmacion.textContent = "";
                    donanteSeleccionadoId = null;
                    btnGuardar.disabled = true;

                    cargarHistorial(); // Refrescar la tabla
                } else {
                    const err = await response.json();
                    msgEl.style.color = "red";
                    msgEl.textContent = err.error || "Error al registrar la donación.";
                }
            } catch (error) {
                msgEl.style.color = "red";
                msgEl.textContent = "Error de conexión con el servidor.";
            }
        });
    }

    // 4. Descargar el Historial en PDF (Se mantiene igual)
    const btnExportarPDF = document.getElementById("btnExportarPDF");
    if (btnExportarPDF) {
        btnExportarPDF.addEventListener("click", async () => {
            try {
                const response = await fetch(`${API_URL}/donaciones/exportar/pdf`, {
                    method: "GET",
                    headers: { "Authorization": `Bearer ${getToken()}` }
                });
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "Historial_Donaciones_MediSign.pdf";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                } else {
                    alert("No se pudo generar el reporte PDF.");
                }
            } catch (error) {
                console.error("Error de conexión:", error);
            }
        });
    }
}