
// 🔒 PROTECCIÓN CONTRA DEVTOOLS Y MODIFICACIÓN DEL CERTIFICADO
(function() {
    'use strict';
    
    // Función auxiliar para verificar si es admin
    // Se asume que window.isAdmin se establece en false al inicio y luego a true tras autenticación
    function siEsAdmin() {
        return window.isAdmin === true;
    }

    // Deshabilitar clic derecho
    document.addEventListener('contextmenu', function(e) {
        if (siEsAdmin()) return;
        e.preventDefault();
        // alert('⚠️ El menú contextual está deshabilitado en esta página por seguridad.');
        // Comentado para ser menos intrusivo, pero bloquea igual
        return false;
    });
    
    // Detectar teclas de acceso a DevTools
    document.addEventListener('keydown', function(e) {
        if (siEsAdmin()) return;

        // F12
        if (e.keyCode === 123) {
            e.preventDefault();
            recargarPaginaPorSeguridad();
            return false;
        }
        
        // Ctrl+Shift+I (Inspector)
        if (e.ctrlKey && e.shiftKey && e.keyCode === 73) {
            e.preventDefault();
            recargarPaginaPorSeguridad();
            return false;
        }
        
        // Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && e.keyCode === 74) {
            e.preventDefault();
            recargarPaginaPorSeguridad();
            return false;
        }
        
        // Ctrl+Shift+C (Inspect Element)
        if (e.ctrlKey && e.shiftKey && e.keyCode === 67) {
            e.preventDefault();
            recargarPaginaPorSeguridad();
            return false;
        }
        
        // Ctrl+U (Ver código fuente)
        if (e.ctrlKey && e.keyCode === 85) {
            e.preventDefault();
            recargarPaginaPorSeguridad();
            return false;
        }
    });
    
    // Función para recargar la página (redirigir a sí misma)
    function recargarPaginaPorSeguridad() {
        if (siEsAdmin()) return;
        alert('🔒 Por razones de seguridad, la página se recargará.\n\nNo está permitido inspeccionar el código.');
        window.location.reload();
    }
    
    // Detectar apertura de DevTools mediante cambio de tamaño (Más agresivo)
    let devtoolsOpen = false;
    const threshold = 160;
    
    // Verificación por tamaño de ventana vs tamaño interno
    setInterval(function() {
        if (siEsAdmin()) return;

        // Excluir dispositivos móviles y táctiles para evitar falsos positivos
        // (El zoom y las barras del navegador en móviles cambian innerWidth/Height activando la alerta)
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
        
        if (isMobile) return;

        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        
        if (widthThreshold || heightThreshold) {
            if (!devtoolsOpen) {
                devtoolsOpen = true;
                recargarPaginaPorSeguridad();
            }
        } else {
            devtoolsOpen = false;
        }
    }, 1000);
    
    // Protección adicional: Detectar debugger
    setInterval(function() {
        if (siEsAdmin()) return;

        const start = new Date();
        // debugger; // Comentado para no molestar durante desarrollo normal si la consola está abierta accidentalmente
        // Descomentar en producción estricta si se desea pausar la ejecución al abrir devtools
        const end = new Date();
        if (end - start > 100) {
            recargarPaginaPorSeguridad();
        }
    }, 2000);
    
    // Mensaje de advertencia en consola (por si logran abrirla antes de la recarga)
    // Solo si no es admin, aunque si la abren antes de ser admin, verán esto.
    if (!siEsAdmin()) {
        console.clear();
        console.log('%c🔒 SEGURIDAD ACTIVADA', 'color: red; font-size: 30px; font-weight: bold;');
    }
})();
