const form = document.getElementById('proposalForm');
const resultBox = document.getElementById('result');
const sectionsBox = document.getElementById('sections');
const errorBox = document.getElementById('errorBox');
const loadingText = document.getElementById('loadingText');
const generateBtn = document.getElementById('generateBtn');

const labels = [
  { key: 'analysis', title: '1. Анализ на запитването' },
  { key: 'service', title: '2. Предложена услуга' },
  { key: 'pricing', title: '3. Ценово предложение' },
  { key: 'proposalDraft', title: '4. Текст за оферта (draft)' },
  { key: 'emailDraft', title: '5. Текст за имейл към клиента' },
  { key: 'upsell', title: '6. Upsell / Next steps' }
];

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {
    showError('Неуспешно копиране. Моля, копирайте текста ръчно.');
  });
}

function renderSection(title, content) {
  const wrapper = document.createElement('article');
  wrapper.className = 'result-section';

  const header = document.createElement('div');
  header.className = 'section-header';

  const heading = document.createElement('h3');
  heading.textContent = title;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-btn';
  button.textContent = 'Копирай';
  button.addEventListener('click', () => copyText(content));

  const textArea = document.createElement('textarea');
  textArea.readOnly = true;
  textArea.value = content;

  header.appendChild(heading);
  header.appendChild(button);
  wrapper.appendChild(header);
  wrapper.appendChild(textArea);

  return wrapper;
}

function setLoading(isLoading) {
  loadingText.classList.toggle('hidden', !isLoading);
  generateBtn.disabled = isLoading;
  generateBtn.textContent = isLoading ? 'Генериране...' : 'Генерирай предложение';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  sectionsBox.innerHTML = '';
  resultBox.classList.add('hidden');

  const payload = {
    leadText: form.leadText.value.trim(),
    company_name: form.company_name.value.trim(),
    industry: form.industry.value.trim(),
    approximate_budget: form.approximate_budget.value.trim(),
    expected_timeline: form.expected_timeline.value.trim()
  };

  if (!payload.leadText) {
    showError('Полето „Опишете вашето запитване“ е задължително.');
    return;
  }

  if (payload.leadText.length > 4000) {
    showError('Запитването е твърде дълго. Максимум 4000 символа.');
    return;
  }

  setLoading(true);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-site-api-key': window.SITE_API_KEY || ''
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Възникна грешка при обработката на заявката.');
    }

    labels.forEach(({ key, title }) => {
      const sectionContent = data[key] || '';
      sectionsBox.appendChild(renderSection(title, sectionContent));
    });

    resultBox.classList.remove('hidden');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showError(error.message || 'Възникна неочаквана грешка.');
  } finally {
    setLoading(false);
  }
});
