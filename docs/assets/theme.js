const themeMap = {
  dark: 'theme-dark',
  light: 'theme-light',
  aqua: 'theme-aqua',
  wave: 'theme-wave',
  oceanfloor: 'theme-oceanfloor'
};

const themeSelector = document.getElementById('themeSelector');

function applyTheme(themeKey) {
  const newThemeClass = themeMap[themeKey] || 'theme-dark';

  // Remove todas as classes de tema possíveis antes de aplicar a nova
  document.body.classList.remove(
    ...Object.values(themeMap)
  );

  document.body.classList.add(newThemeClass);

  // Salva no localStorage para lembrar escolha
  localStorage.setItem('user-theme', themeKey);

  // Atualiza o select
  if (themeSelector) themeSelector.value = themeKey;
  
  // Atualiza os ícones e cores baseados no tema
  updateThemeElements(themeKey);
}

// Função para atualizar elementos visuais baseados no tema
function updateThemeElements(themeKey) {
  const isDark = ['dark', 'wave', 'oceanfloor'].includes(themeKey);
  
  // Ajusta contraste de elementos baseado no tema
  document.querySelectorAll('.card, .artigo-card, .dica-card').forEach(card => {
    if (isDark) {
      card.classList.add('dark-theme-card');
    } else {
      card.classList.remove('dark-theme-card');
    }
  });
}


// Aplica o tema quando o usuário muda o select
if (themeSelector) {
  themeSelector.addEventListener('change', () => {
    applyTheme(themeSelector.value);
  });
}

// Aplica o tema salvo ao carregar qualquer página
window.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('user-theme') || 'dark';
  applyTheme(savedTheme);
});
