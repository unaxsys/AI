const labels = {
  bg: {
    analysis: 'Анализ',
    service: 'Услуга',
    pricing: 'Ценообразуване',
    proposalDraft: 'Проект на предложение',
    emailDraft: 'Проект на имейл',
    upsell: 'Допълнителни предложения'
  },
  en: {
    analysis: 'Analysis',
    service: 'Service',
    pricing: 'Pricing',
    proposalDraft: 'Proposal Draft',
    emailDraft: 'Email Draft',
    upsell: 'Upsell'
  }
};

document.getElementById('generatePublic').onclick = async () => {
  const language = document.getElementById('language').value;
  const payload = {
    leadText: document.getElementById('leadText').value,
    company: document.getElementById('company').value,
    industry: document.getElementById('industry').value,
    budget: document.getElementById('budget').value,
    timeline: document.getElementById('timeline').value,
    language,
    turnstileToken: document.getElementById('turnstileToken').value
  };

  const response = await fetch('/api/public/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    document.getElementById('publicError').textContent = data.error || 'Generation failed';
    return;
  }

  document.getElementById('publicError').textContent = '';
  const root = document.getElementById('publicOutput');
  root.innerHTML = '';
  ['analysis', 'service', 'pricing', 'proposalDraft', 'emailDraft', 'upsell'].forEach((key) => {
    const h3 = document.createElement('h3');
    h3.textContent = labels[language][key];
    const pre = document.createElement('pre');
    pre.textContent = data[key] || '';
    root.appendChild(h3);
    root.appendChild(pre);
  });
};
