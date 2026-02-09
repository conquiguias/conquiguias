
// 🔒 PROTECCIÓN CONTRA DEVTOOLS Y MODIFICACIÓN DEL CERTIFICADO
(function() {
    'use strict';
    
    // Deshabilitar clic derecho
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        // alert('⚠️ El menú contextual está deshabilitado en esta página por seguridad.');
        // Comentado para ser menos intrusivo, pero bloquea igual
        return false;
    });
    
    // Detectar teclas de acceso a DevTools
    document.addEventListener('keydown', function(e) {
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
        alert('🔒 Por razones de seguridad, la página se recargará.\n\nNo está permitido inspeccionar el código.');
        window.location.reload();
    }
    
    // Detectar apertura de DevTools mediante cambio de tamaño (Más agresivo)
    let devtoolsOpen = false;
    const threshold = 160;
    
    // Verificación por tamaño de ventana vs tamaño interno
    setInterval(function() {
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
        const start = new Date();
        // debugger; // Comentado para no molestar durante desarrollo normal si la consola está abierta accidentalmente
        // Descomentar en producción estricta si se desea pausar la ejecución al abrir devtools
        const end = new Date();
        if (end - start > 100) {
            recargarPaginaPorSeguridad();
        }
    }, 2000);
    
    // Mensaje de advertencia en consola (por si logran abrirla antes de la recarga)
    console.clear();
    console.log('%c🔒 SEGURIDAD ACTIVADA', 'color: red; font-size: 30px; font-weight: bold;');
})();
