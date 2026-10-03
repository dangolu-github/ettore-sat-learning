(function () {
  'use strict';

  var ENDPOINT = String((window.ETTORE_PORTAL_CONFIG || {}).submissionEndpoint || '');
  var state = {
    token: '',
    page: 1,
    totalPages: 1,
    currentPractice: null,
    sourceCache: {},
    initialFilters: readInitialFilters(),
    round: readInitialRound()
  };

  var elements = {};
  onReady(function () {
    cacheElements();
    bindEvents();
    applyReviewVisibility();
    if (!window.EttorePortalAccess || !window.EttorePortalAccess.ready) {
      showLogbookStatus('This page could not be opened. Please reload.', true);
      return;
    }
    window.EttorePortalAccess.ready.then(function () {
      state.token = window.EttorePortalAccess.getToken ? window.EttorePortalAccess.getToken() : '';
      if (!state.token) {
        showLogbookStatus('Course access expired. Return to the course home and enter the password again.', true);
        return;
      }
      loadLogbook();
    });
  });

  function cacheElements() {
    [
      'summary-total', 'summary-needs', 'summary-recovered',
      'round-1-tab', 'round-2-tab', 'round-1-count', 'round-2-count',
      'filter-source', 'filter-domain', 'filter-skill', 'filter-theme', 'filter-status',
      'clear-filters', 'practice-mixed', 'practice-filtered', 'logbook-status',
      'logbook-section', 'logbook-title', 'mistake-list', 'result-count', 'show-answers', 'show-mistakes',
      'previous-page', 'next-page', 'page-label',
      'practice-section', 'practice-kicker', 'practice-title', 'practice-intro',
      'practice-status', 'practice-form', 'practice-questions',
      'practice-progress', 'submit-practice', 'practice-result', 'close-practice',
      'print-button'
    ].forEach(function (id) {
      elements[id] = document.getElementById(id);
    });
    selectRound(state.round, false);
  }

  function bindEvents() {
    ['filter-source', 'filter-domain', 'filter-skill', 'filter-theme', 'filter-status'].forEach(function (id) {
      elements[id].addEventListener('change', function () {
        state.page = 1;
        loadLogbook();
      });
    });
    elements['clear-filters'].addEventListener('click', function () {
      ['filter-source', 'filter-domain', 'filter-skill', 'filter-theme'].forEach(function (id) {
        elements[id].value = '';
      });
      elements['filter-status'].value = 'needs-review';
      state.page = 1;
      loadLogbook();
    });
    elements['previous-page'].addEventListener('click', function () {
      if (state.page <= 1) return;
      state.page -= 1;
      loadLogbook();
    });
    elements['next-page'].addEventListener('click', function () {
      if (state.page >= state.totalPages) return;
      state.page += 1;
      loadLogbook();
    });
    elements['practice-mixed'].addEventListener('click', function () { startPractice('mixed'); });
    elements['practice-filtered'].addEventListener('click', function () { startPractice('filtered'); });
    elements['practice-form'].addEventListener('submit', submitPractice);
    elements['practice-questions'].addEventListener('change', updatePracticeProgress);
    elements['close-practice'].addEventListener('click', closePractice);
    elements['print-button'].addEventListener('click', function () { window.print(); });
    elements['show-answers'].addEventListener('change', applyReviewVisibility);
    elements['show-mistakes'].addEventListener('change', applyReviewVisibility);
    ['round-1-tab', 'round-2-tab'].forEach(function (id) {
      elements[id].addEventListener('click', function () {
        selectRound(elements[id].dataset.round, true);
      });
    });
  }

  function loadLogbook() {
    showLogbookStatus('Loading your mistakes…', false);
    elements['mistake-list'].replaceChildren();
    request('getMistakeLogbook', Object.assign({ page: state.page, environment: environment() }, currentFilters()), function (data) {
      if (!data || !data.ok) {
        showLogbookStatus((data && data.error) || 'The Mistake Logbook could not be loaded.', true);
        return;
      }
      state.page = data.page;
      state.totalPages = data.totalPages;
      renderSummary(data.summary || {});
      renderRoundSummary(data.roundSummary || {});
      renderFilterOptions(data.filterOptions || {});
      if (applyInitialFilters()) {
        state.page = 1;
        loadLogbook();
        return;
      }
      renderMistakes(data.items || [], (data.page - 1) * data.pageSize);
      renderPager(data);
    }, function () {
      showLogbookStatus('The Mistake Logbook could not be opened. Please try again.', true);
    });
  }

  function renderSummary(summary) {
    elements['summary-total'].textContent = number(summary.total);
    elements['summary-needs'].textContent = number(summary.needsReview);
    elements['summary-recovered'].textContent = number(summary.recoveredOnce);
  }

  function renderRoundSummary(summary) {
    elements['round-1-count'].textContent = number(summary.round1 && summary.round1.total);
    elements['round-2-count'].textContent = number(summary.round2 && summary.round2.total);
  }

  function renderFilterOptions(options) {
    renderSelectOptions(elements['filter-source'], options.source || [], 'All sources');
    renderSelectOptions(elements['filter-domain'], options.domain || [], 'All domains');
    renderSelectOptions(elements['filter-skill'], options.skill || [], 'All question types');
    renderSelectOptions(elements['filter-theme'], options.theme || [], 'All topics and themes', naturalOptionCompare);
  }

  function renderSelectOptions(select, options, allLabel, compare) {
    var selected = select.value;
    var ordered = options.slice();
    if (compare) ordered.sort(compare);
    select.replaceChildren();
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    ordered.forEach(function (item) {
      var option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.value + ' (' + item.count + ')';
      select.appendChild(option);
    });
    if (Array.from(select.options).some(function (option) { return option.value === selected; })) select.value = selected;
  }

  function naturalOptionCompare(left, right) {
    return String(left.value).localeCompare(String(right.value), undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function readInitialFilters() {
    var parameters = new URLSearchParams(window.location.search);
    var result = {};
    ['source', 'domain', 'skill', 'theme', 'status'].forEach(function (key) {
      var value = String(parameters.get(key) || '').trim();
      if (value) result[key] = value;
    });
    return result;
  }

  function readInitialRound() {
    var value = new URLSearchParams(window.location.search).get('round');
    return value === 'round2' ? 'round2' : 'round1';
  }

  function selectRound(round, shouldLoad) {
    state.round = round === 'round1' ? 'round1' : 'round2';
    ['round1', 'round2'].forEach(function (value) {
      var tab = elements[value === 'round1' ? 'round-1-tab' : 'round-2-tab'];
      var active = value === state.round;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    elements['logbook-title'].textContent = (state.round === 'round1' ? 'Stage 1' : 'Stage 2') + ' mistake questions';
    state.page = 1;
    if (shouldLoad && state.token) loadLogbook();
  }

  function applyInitialFilters() {
    var filters = state.initialFilters;
    state.initialFilters = null;
    if (!filters) return false;
    var changed = false;
    Object.keys(filters).forEach(function (key) {
      var select = elements['filter-' + key];
      if (!select) return;
      if (!Array.from(select.options).some(function (option) { return option.value === filters[key]; })) return;
      if (select.value !== filters[key]) {
        select.value = filters[key];
        changed = true;
      }
    });
    return changed;
  }

  function applyReviewVisibility() {
    elements['logbook-section'].classList.toggle('show-answers', elements['show-answers'].checked);
    elements['logbook-section'].classList.toggle('show-mistakes', elements['show-mistakes'].checked);
  }

  function renderMistakes(items, startIndex) {
    elements['mistake-list'].replaceChildren();
    if (!items.length) {
      showLogbookStatus('No mistakes match these filters.', false);
      return;
    }
    showLogbookStatus('Loading mistake questions…', false);
    Promise.all(items.map(function (item, index) {
      return buildMistakeCard(item, startIndex + index + 1);
    })).then(function (cards) {
      elements['mistake-list'].replaceChildren.apply(elements['mistake-list'], cards);
      elements['logbook-status'].hidden = true;
    }).catch(function () {
      showLogbookStatus('Some mistake questions could not be displayed. Reload the page to try again.', true);
    });
  }

  function buildMistakeCard(item, displayNumber) {
    var card = document.createElement('article');
    card.className = 'mistake-card';
    var header = document.createElement('div');
    header.className = 'mistake-card-header';
    var heading = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = 'Question ' + displayNumber;
    var origin = document.createElement('p');
    origin.className = 'mistake-origin';
    origin.textContent = item.assignmentLabel + ' · Item ' + item.questionNumber;
    var tags = document.createElement('div');
    tags.className = 'question-tags';
    [item.domain, item.skill, item.theme].filter(Boolean).forEach(function (value) {
      var tag = document.createElement('span');
      tag.textContent = value;
      tags.appendChild(tag);
    });
    heading.append(title, origin, tags);
    var status = document.createElement('div');
    status.className = 'mistake-card-status';
    var pill = document.createElement('span');
    pill.className = 'status-pill ' + item.status;
    pill.textContent = statusLabel(item.status);
    status.appendChild(pill);
    var remove = document.createElement('button');
    remove.className = 'remove-mistake-button';
    remove.type = 'button';
    remove.textContent = 'Remove from logbook';
    remove.addEventListener('click', function () { dismissMistake(item, card, remove); });
    status.appendChild(remove);
    header.append(heading, status);
    card.appendChild(header);

    return loadSourceQuestion(item).then(function (source) {
      card.append(source.content, buildPastAnswerChoices(item, source.choices));
      return card;
    }).catch(function () {
      card.classList.add('is-unavailable');
      var message = document.createElement('p');
      message.className = 'question-unavailable';
      message.textContent = 'This question could not be displayed. Reload the page to try again.';
      card.appendChild(message);
      return card;
    });
  }

  function dismissMistake(item, card, button) {
    var roundLabel = item.round === 'round1' ? 'Stage 1' : 'Stage 2';
    if (!window.confirm('Remove this question from the ' + roundLabel + ' Mistake Logbook? Your original homework result will stay unchanged.')) return;
    var dismissalId = createId();
    button.disabled = true;
    button.textContent = 'Removing…';
    var payload = {
      action: 'dismissMistake',
      accessToken: state.token,
      dismissalId: dismissalId,
      environment: environment(),
      key: item.key
    };
    window.fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function () {
      pollDismissal(dismissalId, item, card, button, 0);
    }).catch(function () {
      button.disabled = false;
      button.textContent = 'Remove from logbook';
      showLogbookStatus('The question could not be removed. Please try again.', true);
    });
  }

  function pollDismissal(dismissalId, item, card, button, attempt) {
    request('getMistakeDismissalResult', { dismissalId: dismissalId }, function (data) {
      if (data && data.ok && !data.pending && data.key === item.key) {
        card.remove();
        showLogbookStatus('Question removed from this logbook. Your original homework result is unchanged.', false);
        window.setTimeout(loadLogbook, 450);
        return;
      }
      if (attempt >= 20) {
        button.disabled = false;
        button.textContent = 'Remove from logbook';
        showLogbookStatus('The removal is taking longer than expected. Reload to check again.', true);
        return;
      }
      window.setTimeout(function () { pollDismissal(dismissalId, item, card, button, attempt + 1); }, 1000);
    }, function () {
      if (attempt >= 20) {
        button.disabled = false;
        button.textContent = 'Remove from logbook';
        showLogbookStatus('Please reload to check.', true);
        return;
      }
      window.setTimeout(function () { pollDismissal(dismissalId, item, card, button, attempt + 1); }, 1000);
    });
  }

  function buildPastAnswerChoices(item, choices) {
    var wrapper = document.createElement('div');
    wrapper.className = 'redo-choices past-answer-choices';
    choices.slice(0, 4).forEach(function (choiceText, index) {
      var letter = String.fromCharCode(65 + index);
      var choice = document.createElement('div');
      choice.className = 'redo-choice past-answer-choice';
      var text = choiceContent(choiceText);
      choice.appendChild(text);
      if (letter === item.correctAnswer) {
        choice.classList.add('is-correct-answer');
        var correctLabel = document.createElement('strong');
        correctLabel.className = 'correct-answer-label';
        correctLabel.textContent = 'Correct answer';
        choice.appendChild(correctLabel);
      }
      if (letter === item.selectedAnswer) {
        choice.classList.add('is-past-answer');
        var label = document.createElement('strong');
        label.className = 'past-answer-label';
        label.textContent = 'Past answer';
        choice.appendChild(label);
      }
      wrapper.appendChild(choice);
    });
    if (!item.selectedAnswer) {
      var blank = document.createElement('p');
      blank.className = 'past-answer-blank';
      blank.textContent = 'Past answer: Blank';
      wrapper.appendChild(blank);
    }
    return wrapper;
  }

  function renderPager(data) {
    elements['result-count'].textContent = data.total + ' matching mistake' + (data.total === 1 ? '' : 's');
    elements['page-label'].textContent = 'Page ' + data.page + ' of ' + data.totalPages;
    elements['previous-page'].disabled = data.page <= 1;
    elements['next-page'].disabled = data.page >= data.totalPages;
  }

  function startPractice(mode) {
    setPracticeButtonsDisabled(true);
    var parameters = mode === 'filtered'
      ? Object.assign({ mode: mode }, currentFilters())
      : { mode: mode, round: state.round, environment: environment() };
    parameters.environment = environment();
    request('getMistakePracticeSelection', parameters, function (data) {
      setPracticeButtonsDisabled(false);
      if (!data || !data.ok) {
        showLogbookStatus((data && data.error) || 'The practice set could not be created.', true);
        return;
      }
      if (!data.items || !data.items.length) {
        showLogbookStatus(mode === 'filtered' ? 'No mistakes match this filtered practice.' : 'No past mistakes are available yet.', false);
        return;
      }
      state.currentPractice = {
        sessionId: data.sessionId,
        mode: data.mode,
        filters: data.filters || {},
        items: data.items,
        submitted: false
      };
      renderPractice();
    }, function () {
      setPracticeButtonsDisabled(false);
      showLogbookStatus('The practice set could not be made. Please try again.', true);
    });
  }

  function renderPractice() {
    var practice = state.currentPractice;
    elements['practice-section'].hidden = false;
    elements['practice-kicker'].textContent = practice.mode === 'mixed' ? 'Mixed past mistakes' : 'Filtered mistakes';
    elements['practice-title'].textContent = practice.items.length + '-question redo session';
    elements['practice-intro'].textContent = practice.mode === 'mixed'
      ? 'A mixed sample from all past mistake questions.'
      : 'A focused sample from the filters currently selected above.';
    elements['practice-status'].hidden = false;
    elements['practice-status'].className = 'status-message';
    elements['practice-status'].textContent = 'Loading question content…';
    elements['practice-questions'].replaceChildren();
    elements['practice-result'].hidden = true;
    elements['practice-result'].replaceChildren();
    elements['submit-practice'].disabled = false;
    elements['submit-practice'].textContent = 'Submit and check';

    Promise.all(practice.items.map(function (item, index) {
      return buildPracticeQuestion(item, index + 1);
    })).then(function (cards) {
      cards.forEach(function (card) { elements['practice-questions'].appendChild(card); });
      elements['practice-status'].hidden = true;
      updatePracticeProgress();
      elements['practice-section'].scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function buildPracticeQuestion(item, practiceNumber) {
    var card = document.createElement('article');
    card.className = 'practice-question';
    card.dataset.key = item.key;

    var header = document.createElement('div');
    header.className = 'practice-question-header';
    var heading = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = 'Redo ' + practiceNumber;
    heading.appendChild(title);
    var tags = document.createElement('div');
    tags.className = 'question-tags';
    var tag = document.createElement('span');
    tag.textContent = item.skill;
    tags.appendChild(tag);
    header.append(heading, tags);
    card.appendChild(header);

    return loadSourceQuestion(item).then(function (source) {
      card.append(source.content, buildChoiceControls(item, source.choices));
      return card;
    }).catch(function () {
      var note = document.createElement('p');
      note.className = 'question-unavailable';
      note.textContent = 'This question could not be displayed. Close this session and try again.';
      card.append(note, buildChoiceControls(item, ['A.', 'B.', 'C.', 'D.']));
      return card;
    });
  }

  function loadSourceQuestion(item) {
    var path = item.sourcePath;
    if (item.supplement && item.supplement.stem) return Promise.resolve(supplementSourceQuestion(item.supplement));
    if (!state.sourceCache[path]) {
      state.sourceCache[path] = window.fetch(publicPathUrl(path), { credentials: 'same-origin' }).then(function (response) {
        if (!response.ok) throw new Error('This question could not be shown.');
        return response.text();
      }).then(function (html) {
        return new DOMParser().parseFromString(html, 'text/html');
      });
    }
    return state.sourceCache[path].then(function (documentSource) {
      var questions = documentSource.querySelectorAll('.question, .exam-question');
      if (!questions.length) questions = documentSource.querySelectorAll('main > article');
      var original = questions[item.questionNumber - 1];
      if (!original) throw new Error('Question not found.');
      var choiceNodes = original.querySelectorAll('.choice, .option');
      if (!choiceNodes.length) choiceNodes = original.querySelectorAll('.choices > li, .choices > div');
      var choices = Array.from(choiceNodes).map(function (choice, index) {
        var text = choice.textContent.replace(/\s+/g, ' ').trim();
        return text || String.fromCharCode(65 + index) + '.';
      });
      var clone = original.cloneNode(true);
      clone.classList.add('source-question');
      clone.removeAttribute('id');
      clone.querySelectorAll('.qhead, .q-head, .choices, .options, .option-list, .answer-prompt, .work, .micro-check, .hint, .hintbody, .hint-rule, .hint-line, .nohint, .reading-map, textarea, input, button, script, style').forEach(function (node) {
        node.remove();
      });
      var prompt = clone.querySelector('.stem, .prompt, .question-prompt');
      if (!prompt) {
        var paragraphs = clone.querySelectorAll('p');
        prompt = paragraphs.length ? paragraphs[paragraphs.length - 1] : null;
      }
      if (prompt) prompt.classList.add('logbook-question-prompt');
      clone.querySelectorAll('img').forEach(function (image) {
        var source = image.getAttribute('src');
        if (source) image.setAttribute('src', new URL(source, publicPathUrl(path)).href);
        image.alt = 'SAT question passage and answer choices';
      });
      return { content: clone, choices: choices.length ? choices : ['A.', 'B.', 'C.', 'D.'] };
    });
  }

  function supplementMarkup(text) {
    return String(text).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    }).replace(/«u»/g, '<u>').replace(/«\/u»/g, '</u>');
  }

  function supplementSourceQuestion(supplement) {
    var article = document.createElement('article');
    article.className = 'source-question supplement-source-question';
    var passage = document.createElement('div');
    passage.className = 'passage';
    String(supplement.passage || '').split(/\n\s*\n/).forEach(function (part) {
      if (!part.trim()) return;
      var paragraph = document.createElement('p');
      paragraph.innerHTML = supplementMarkup(part.trim());
      passage.appendChild(paragraph);
    });
    var stem = document.createElement('p');
    stem.className = 'logbook-question-prompt';
    stem.innerHTML = supplementMarkup(String(supplement.stem || ''));
    article.append(passage, stem);
    var choices = (supplement.options || []).slice(0, 4).map(function (text, index) { return String.fromCharCode(65 + index) + '. ' + text; });
    return { content: article, choices: choices.length === 4 ? choices : ['A.', 'B.', 'C.', 'D.'] };
  }

  function choiceContent(choiceValue) {
    var wrapper = document.createElement('span');
    if (choiceValue && typeof choiceValue === 'object' && choiceValue.image) {
      var label = document.createElement('strong');
      label.textContent = choiceValue.label || '';
      var image = document.createElement('img');
      image.className = 'redo-choice-image';
      image.src = choiceValue.image;
      image.alt = 'Answer option ' + String(choiceValue.label || '').replace('.', '');
      image.loading = 'lazy';
      wrapper.append(label, image);
      return wrapper;
    }
    wrapper.textContent = String(choiceValue == null ? '' : choiceValue);
    return wrapper;
  }

  function buildChoiceControls(item, choices) {
    var wrapper = document.createElement('div');
    wrapper.className = 'redo-choices';
    choices.slice(0, 4).forEach(function (choiceText, index) {
      var letter = String.fromCharCode(65 + index);
      var label = document.createElement('label');
      label.className = 'redo-choice';
      label.dataset.answer = letter;
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'mistake-' + item.key.replace(/[^A-Za-z0-9_-]/g, '-');
      input.value = letter;
      var text = choiceContent(choiceText);
      label.append(input, text);
      wrapper.appendChild(label);
    });
    return wrapper;
  }

  function submitPractice(event) {
    event.preventDefault();
    var practice = state.currentPractice;
    if (!practice || practice.submitted) return;
    var answers = practice.items.map(function (item) {
      var card = elements['practice-questions'].querySelector('[data-key="' + cssEscape(item.key) + '"]');
      var selected = card && card.querySelector('input[type="radio"]:checked');
      return { key: item.key, answer: selected ? selected.value : '' };
    });
    var blankCount = answers.filter(function (item) { return !item.answer; }).length;
    if (blankCount && !window.confirm(blankCount + ' question' + (blankCount === 1 ? ' is' : 's are') + ' unanswered. Submit anyway? Blank answers count as incorrect.')) return;

    practice.submitted = true;
    elements['submit-practice'].disabled = true;
    elements['submit-practice'].textContent = 'Checking…';
    elements['practice-status'].hidden = false;
    elements['practice-status'].className = 'status-message';
    elements['practice-status'].textContent = 'Checking your answers…';
    var payload = {
      action: 'submitMistakePractice',
      accessToken: state.token,
      sessionId: practice.sessionId,
      environment: environment(),
      mode: practice.mode,
      filters: practice.filters,
      items: answers
    };
    window.fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function () {
      pollPracticeResult(0);
    }).catch(function () {
      practice.submitted = false;
      elements['submit-practice'].disabled = false;
      elements['submit-practice'].textContent = 'Submit and check';
      showPracticeStatus('The redo could not be submitted. Please try again.', true);
    });
  }

  function pollPracticeResult(attempt) {
    if (!state.currentPractice) return;
    request('getMistakePracticeResult', { sessionId: state.currentPractice.sessionId }, function (data) {
      if (data && data.ok && !data.pending) {
        renderPracticeResult(data);
        return;
      }
      if (attempt >= 20) {
        state.currentPractice.submitted = false;
        elements['submit-practice'].disabled = false;
        elements['submit-practice'].textContent = 'Submit and check';
        showPracticeStatus('Your answers were sent. The result is taking longer than usual. Please try again in a moment.', true);
        return;
      }
      window.setTimeout(function () { pollPracticeResult(attempt + 1); }, 1000);
    }, function () {
      if (attempt >= 20) {
        state.currentPractice.submitted = false;
        elements['submit-practice'].disabled = false;
        elements['submit-practice'].textContent = 'Submit and check';
        showPracticeStatus('The result is not available right now.', true);
        return;
      }
      window.setTimeout(function () { pollPracticeResult(attempt + 1); }, 1000);
    });
  }

  function renderPracticeResult(result) {
    var byKey = {};
    result.questionKeys.forEach(function (key, index) {
      byKey[key] = {
        answer: result.answers[index] || '',
        correctAnswer: result.correctAnswers[index],
        correct: result.correctness[index] === true
      };
    });
    state.currentPractice.items.forEach(function (item) {
      var checked = byKey[item.key];
      var card = elements['practice-questions'].querySelector('[data-key="' + cssEscape(item.key) + '"]');
      if (!checked || !card) return;
      card.classList.add(checked.correct ? 'is-correct' : 'is-wrong');
      card.querySelectorAll('.redo-choice').forEach(function (choice) {
        var letter = choice.dataset.answer;
        if (letter === checked.correctAnswer) choice.classList.add('is-correct');
        if (letter === checked.answer && !checked.correct) choice.classList.add('is-wrong');
      });
      card.querySelectorAll('input').forEach(function (input) { input.disabled = true; });
      var note = document.createElement('div');
      note.className = 'result-note ' + (checked.correct ? 'correct' : 'wrong');
      note.textContent = checked.correct
        ? 'Correct · Recovered once'
        : 'Your answer: ' + (checked.answer || 'Blank') + ' · Correct answer: ' + checked.correctAnswer + ' · Still needs review';
      card.appendChild(note);
    });
    elements['practice-status'].hidden = true;
    elements['submit-practice'].textContent = 'Checked';
    elements['practice-result'].hidden = false;
    var heading = document.createElement('h3');
    heading.textContent = result.score + ' / ' + result.total + ' correct';
    var copy = document.createElement('p');
    copy.textContent = 'Questions you got right are now marked Recovered once. The others stay in Needs review.';
    elements['practice-result'].append(heading, copy);
    loadLogbook();
    elements['practice-result'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updatePracticeProgress() {
    var practice = state.currentPractice;
    if (!practice) return;
    var answered = elements['practice-questions'].querySelectorAll('input[type="radio"]:checked').length;
    elements['practice-progress'].textContent = answered + ' of ' + practice.items.length + ' answered';
  }

  function closePractice() {
    state.currentPractice = null;
    elements['practice-section'].hidden = true;
    elements['practice-questions'].replaceChildren();
    document.getElementById('logbook-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function currentFilters() {
    return {
      round: state.round,
      source: elements['filter-source'].value,
      domain: elements['filter-domain'].value,
      skill: elements['filter-skill'].value,
      theme: elements['filter-theme'].value,
      status: elements['filter-status'].value
    };
  }

  function request(action, parameters, success, failure) {
    if (!ENDPOINT) {
      failure(new Error('Not available right now.'));
      return;
    }
    var callbackName = '__ettoreMistakeLogbook' + Date.now() + Math.random().toString(16).slice(2);
    var script = document.createElement('script');
    var timeout = window.setTimeout(function () { cleanup(); failure(); }, 12000);
    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[callbackName] = function (data) { cleanup(); success(data); };
    script.onerror = function () { cleanup(); failure(); };
    var query = Object.keys(parameters || {}).filter(function (key) {
      return parameters[key] !== '' && parameters[key] !== null && parameters[key] !== undefined;
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(parameters[key]);
    });
    query.push('action=' + encodeURIComponent(action));
    query.push('accessToken=' + encodeURIComponent(state.token));
    query.push('callback=' + encodeURIComponent(callbackName));
    query.push('_=' + Date.now());
    script.src = ENDPOINT + '?' + query.join('&');
    document.head.appendChild(script);
  }

  function publicPathUrl(path) {
    return new URL('../' + String(path || '').replace(/^\/+/, ''), window.location.href).href;
  }

  function environment() {
    return 'production';
  }

  function showLogbookStatus(message, isError) {
    elements['logbook-status'].hidden = false;
    elements['logbook-status'].className = 'status-message' + (isError ? ' is-error' : '');
    elements['logbook-status'].textContent = message;
  }

  function showPracticeStatus(message, isError) {
    elements['practice-status'].hidden = false;
    elements['practice-status'].className = 'status-message' + (isError ? ' is-error' : '');
    elements['practice-status'].textContent = message;
  }

  function setPracticeButtonsDisabled(disabled) {
    elements['practice-mixed'].disabled = disabled;
    elements['practice-filtered'].disabled = disabled;
  }

  function statusLabel(status) {
    return status === 'recovered-once' ? 'Recovered once' : 'Needs review';
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'dismiss-' + Date.now() + '-' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }

  function number(value) {
    return Number(value) || 0;
  }

  function cssEscape(value) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(value);
    return String(value).replace(/(["\\])/g, '\\$1');
  }

  function onReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }
}());
