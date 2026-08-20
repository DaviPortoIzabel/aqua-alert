document.getElementById("loginBtn").addEventListener("click", () => {
  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value.trim();
  const errorMsg = document.getElementById("errorMsg");

  // 🔑 Usuário e senha fixos
  const validUser = "cliente@example.com";
  const validPass = "123456";

  if (user === validUser && pass === validPass) {
    sessionStorage.setItem("loggedIn", "true");

    // Ativa a animação da água
    const water = document.getElementById("waterTransition");
    water.classList.add("active");

    // Redireciona depois que a animação terminar
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500); // tempo da animação
  } else {
    errorMsg.classList.remove("hidden");
  }
});

// 🚨 Bloqueia acesso direto ao dashboard sem login
if (window.location.pathname.endsWith("index.html") && sessionStorage.getItem("loggedIn") !== "true") {
  window.location.href = "login.html";
}

// Eventos dos links extras
document.getElementById("forgotPass").addEventListener("click", (e) => {
  e.preventDefault();
  alert("⚠️ Função de recuperação de senha ainda não implementada.");
});

document.getElementById("createAcc").addEventListener("click", (e) => {
  e.preventDefault();
  alert("⚠️ Função de criação de conta ainda não implementada.");
});
