const cookieConsent = () => {
    
    if (!localStorage.getItem("cookiesAllowed")) {
    
        alert("Hi there! By continue to use this website you consent to the use of cookies or similar technologies. Press ok to consent to this and continue.");
    
        localStorage.setItem("cookiesAllowed", "allowed");
    
    }
    
}

window.onload = cookieConsent;