const cookieConsent = () => {
    
    if ((localStorage.getItem("consented") != "true") && window.location.pathname != "/tc" && window.location.pathname != "/privacy") {
    
        document.getElementById('consentDialog').showModal()
        
    }
    
}

window.onload = cookieConsent;