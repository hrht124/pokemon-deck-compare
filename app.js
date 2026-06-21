(function () {
  const CATEGORY_ALIASES = new Map([
    ["pokemon", "Pokemon"],
    ["pokémon", "Pokemon"],
    ["ポケモン", "Pokemon"],
    ["trainer", "Trainer"],
    ["trainers", "Trainer"],
    ["トレーナー", "Trainer"],
    ["トレーナーズ", "Trainer"],
    ["グッズ", "Trainer"],
    ["サポート", "Trainer"],
    ["スタジアム", "Trainer"],
    ["energy", "Energy"],
    ["energies", "Energy"],
    ["エネルギー", "Energy"],
  ]);

  const CATEGORY_ORDER = new Map([
    ["Pokemon", 0],
    ["Trainer", 1],
    ["Energy", 2],
    ["Other", 3],
  ]);

  const CARD_NAME_ALIASES = new Map([
    ["博士の研究", "博士の研究"],
    ["アララギ博士", "博士の研究"],
    ["プラターヌ博士", "博士の研究"],
  ]);

  const DEFAULT_SAMPLE = `### Charizard A
Pokemon
4 Charmander
1 Charmeleon
3 Charizard ex
2 Pidgey
2 Pidgeot ex
1 Radiant Charizard

Trainers
4 Rare Candy
4 Ultra Ball
4 Arven
3 Iono
2 Boss's Orders
2 Super Rod

Energy
7 Fire Energy

### Charizard B
Pokemon
4 Charmander
1 Charmeleon
2 Charizard ex
2 Pidgey
2 Pidgeot ex
1 Rotom V

Trainers
4 Rare Candy
4 Ultra Ball
3 Arven
4 Iono
2 Boss's Orders
1 Super Rod
1 Forest Seal Stone

Energy
7 Fire Energy

### Charizard C
Pokemon
4 Charmander
1 Charmeleon
3 Charizard ex
2 Pidgey
2 Pidgeot ex
1 Lumineon V

Trainers
4 Rare Candy
4 Ultra Ball
4 Arven
3 Iono
1 Boss's Orders
2 Super Rod
1 Counter Catcher

Energy
6 Fire Energy`;

  const state = {
    decks: [],
    fetchedDecks: [],
    eventRows: [],
    eventInfo: null,
    deckMetadata: new Map(),
    cardMeta: new Map(),
    library: null,
    selectedCategory: "All",
    selectedArchetype: "All",
    selectedEnvironments: new Set(),
    minAdoption: 0.67,
    search: "",
    sort: "adoption",
    viewMode: "text",
  };

  const els = {};

  function extractDeckId(value) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) {
      return null;
    }
    const urlMatch = trimmed.match(/\/deckID\/([A-Za-z0-9-]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2}$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  }

  function parseDeckIdInput(input) {
    const ids = [];
    input
      .split(/[\s,]+/)
      .map(extractDeckId)
      .filter(Boolean)
      .forEach((id) => {
        if (!ids.includes(id)) {
          ids.push(id);
        }
      });
    return ids;
  }

  function normalizeCardName(name) {
    return name
      .replace(/\s+/g, " ")
      .replace(/[　]/g, " ")
      .trim();
  }

  function canonicalCardName(name) {
    const normalized = normalizeCardName(name);
    return CARD_NAME_ALIASES.get(normalized) || normalized;
  }

  function normalizeForKey(name) {
    return canonicalCardName(name).toLocaleLowerCase();
  }

  function cardMetaForName(name) {
    return state.cardMeta.get(normalizeForKey(name)) || null;
  }

  function registerCardMeta(card) {
    if (!card || !card.name) {
      return;
    }
    const key = normalizeForKey(card.name);
    if (!state.cardMeta.has(key)) {
      state.cardMeta.set(key, {
        id: card.id || "",
        imageUrl: card.image_url || "",
        officialUrl: card.official_url || "",
      });
    }
  }

  function registerDeckPayloadMetadata(decks) {
    state.cardMeta = new Map();
    decks.forEach((deck) => {
      (deck.cards || []).forEach(registerCardMeta);
    });
  }

  function normalizeCategory(line) {
    const key = line.trim().toLocaleLowerCase();
    return CATEGORY_ALIASES.get(key) || null;
  }

  function parseCardLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      return null;
    }

    const leading = trimmed.match(/^(\d{1,2})\s*[xX枚]?\s+(.+)$/);
    if (leading) {
      return { count: Number(leading[1]), name: normalizeCardName(leading[2]) };
    }

    const trailingX = trimmed.match(/^(.+?)\s*[xX]\s*(\d{1,2})$/);
    if (trailingX) {
      return { count: Number(trailingX[2]), name: normalizeCardName(trailingX[1]) };
    }

    const trailing = trimmed.match(/^(.+?)\s+(\d{1,2})$/);
    if (trailing) {
      return { count: Number(trailing[2]), name: normalizeCardName(trailing[1]) };
    }

    return null;
  }

  function createDeck(name) {
    return {
      name: name || "Untitled Deck",
      deckId: extractDeckId(name || "") || name || "",
      metadata: null,
      cards: new Map(),
      displayNames: new Map(),
      categories: new Map(),
      categoryTotals: new Map(),
      totalCards: 0,
    };
  }

  function addCard(deck, parsed, category) {
    if (!parsed || parsed.count <= 0 || parsed.count > 99 || !parsed.name) {
      return;
    }
    const key = normalizeForKey(parsed.name);
    const displayName = canonicalCardName(parsed.name);
    const nextCount = (deck.cards.get(key) || 0) + parsed.count;
    deck.cards.set(key, nextCount);
    deck.displayNames.set(key, displayName);
    if (!deck.categories.has(key)) {
      deck.categories.set(key, category || "Other");
    }
    deck.categoryTotals.set(
      category || "Other",
      (deck.categoryTotals.get(category || "Other") || 0) + parsed.count,
    );
    deck.totalCards += parsed.count;
  }

  function isDeckHeading(line) {
    const trimmed = line.trim();
    if (/^#{2,6}\s+\S/.test(trimmed)) {
      return trimmed.replace(/^#{2,6}\s+/, "").trim();
    }
    if (/^={3,}\s*.+?\s*={0,}$/.test(trimmed)) {
      return trimmed.replace(/^=+\s*/, "").replace(/\s*=+$/, "").trim();
    }
    if (/^deck\s*[:：]\s*.+/i.test(trimmed)) {
      return trimmed.replace(/^deck\s*[:：]\s*/i, "").trim();
    }
    return null;
  }

  function parseDecks(input) {
    const decks = [];
    let current = null;
    let currentCategory = "Other";

    input.split(/\r?\n/).forEach((line) => {
      const heading = isDeckHeading(line);
      if (heading) {
        if (current && current.totalCards > 0) {
          decks.push(current);
        }
        current = createDeck(heading);
        currentCategory = "Other";
        return;
      }

      const category = normalizeCategory(line);
      if (category) {
        currentCategory = category;
        if (!current) {
          current = createDeck(`Deck ${decks.length + 1}`);
        }
        return;
      }

      const parsed = parseCardLine(line);
      if (!parsed) {
        return;
      }

      if (!current) {
        current = createDeck(`Deck ${decks.length + 1}`);
      }
      addCard(current, parsed, currentCategory);
    });

    if (current && current.totalCards > 0) {
      decks.push(current);
    }

    return decks;
  }

  function buildDeckMetadataMap(rows, eventInfo) {
    const metadata = new Map();
    rows.forEach((row) => {
      if (!row.deck_id) {
        return;
      }
      metadata.set(row.deck_id, {
        deckId: row.deck_id,
        placement: row.placement || "",
        archetype: row.archetype || "",
        eventId: row.event_id || eventInfo?.id || "",
        eventName: row.event_name || eventInfo?.name || "",
        sourceUrl: row.source_url || eventInfo?.source_url || "",
      });
    });
    return metadata;
  }

  function attachDeckMetadata(decks, metadataMap) {
    decks.forEach((deck) => {
      deck.deckId = extractDeckId(deck.name) || deck.name;
      deck.metadata = metadataMap.get(deck.deckId) || null;
    });
    return decks;
  }

  function normalizeSavedMetadata(metadata, deckId) {
    if (!metadata) {
      return null;
    }
    return {
      deckId: metadata.deckId || metadata.deck_id || deckId,
      placement: metadata.placement || "",
      archetype: metadata.archetype || "",
      eventId: metadata.eventId || metadata.event_id || "",
      eventName: metadata.eventName || metadata.event_name || "",
      sourceUrl: metadata.sourceUrl || metadata.source_url || "",
    };
  }

  function metadataToEventRow(metadata) {
    return {
      deck_id: metadata.deckId,
      placement: metadata.placement,
      archetype: metadata.archetype,
      event_id: metadata.eventId,
      event_name: metadata.eventName,
      source_url: metadata.sourceUrl,
    };
  }

  function normalizeStoredDeck(deck) {
    const id = deck.id || deck.deckId || deck.name || "";
    const metadata = normalizeSavedMetadata(deck.metadata, id);
    return {
      id,
      name: deck.name || id,
      total: deck.total || 0,
      cards: (deck.cards || []).map((card) => ({
        id: card.id || card.card_id || "",
        count: Number(card.count || 0),
        name: card.name || "",
        category: card.category || "Other",
        section: card.section || card.category || "Other",
        image_url: card.image_url || card.imageUrl || "",
        official_url: card.official_url || card.officialUrl || "",
      })),
      text: deck.text || "",
      metadata,
    };
  }

  function serializeParsedDeck(deck) {
    const byCategory = new Map();
    deck.cards.forEach((count, key) => {
      const category = deck.categories.get(key) || "Other";
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category).push({
        count,
        name: deck.displayNames.get(key),
      });
    });

    const lines = [`### ${deck.deckId || deck.name}`];
    ["Pokemon", "Trainer", "Energy", "Other"].forEach((category) => {
      const cards = byCategory.get(category);
      if (!cards?.length) {
        return;
      }
      lines.push("", category);
      cards.forEach((card) => {
        lines.push(`${card.count} ${card.name}`);
      });
    });
    return lines.join("\n");
  }

  function parsedDeckToStoredDeck(deck) {
    const id = deck.deckId || extractDeckId(deck.name) || deck.name;
    const cards = [];
    deck.cards.forEach((count, key) => {
      const name = deck.displayNames.get(key);
      const meta = cardMetaForName(name);
      cards.push({
        id: meta?.id || "",
        count,
        name,
        category: deck.categories.get(key) || "Other",
        section: deck.categories.get(key) || "Other",
        image_url: meta?.imageUrl || "",
        official_url: meta?.officialUrl || "",
      });
    });
    return normalizeStoredDeck({
      id,
      name: deck.name,
      total: deck.totalCards,
      cards,
      text: serializeParsedDeck(deck),
      metadata: deck.metadata || state.deckMetadata.get(id) || null,
    });
  }

  function fetchedDeckToStoredDeck(deck) {
    const id = deck.id || deck.deckId || "";
    return normalizeStoredDeck({
      ...deck,
      id,
      name: deck.name || id,
      metadata: state.deckMetadata.get(id) || normalizeSavedMetadata(deck.metadata, id) || null,
    });
  }

  function buildLibraryPayload() {
    const sourceDecks = state.fetchedDecks.length
      ? state.fetchedDecks.map(fetchedDeckToStoredDeck)
      : state.decks.map(parsedDeckToStoredDeck);
    return {
      event: state.eventInfo,
      rows: state.eventRows,
      decks: sourceDecks,
    };
  }

  function restoreLibrary(library) {
    const decksById = library?.decks || {};
    const decks = Object.values(decksById).map(normalizeStoredDeck);
    const events = Object.values(library?.events || {});

    state.library = library;
    state.fetchedDecks = decks;
    state.eventInfo = events.length ? events[events.length - 1] : null;
    state.eventRows = [];
    state.deckMetadata = new Map();

    decks.forEach((deck) => {
      if (!deck.metadata) {
        return;
      }
      state.deckMetadata.set(deck.id, deck.metadata);
      state.eventRows.push(metadataToEventRow(deck.metadata));
    });

    registerDeckPayloadMetadata(decks);
    if (state.eventInfo?.source_url) {
      els.eventUrlInput.value = state.eventInfo.source_url;
    }
    els.deckIdInput.value = decks.map((deck) => deck.id).join("\n");
    els.deckInput.value = decks
      .map((deck) => deck.text || serializeStoredDeck(deck))
      .filter(Boolean)
      .join("\n\n");
    renderEventRows(state.eventRows);
    parseAndRender();
  }

  function serializeStoredDeck(deck) {
    const lines = [`### ${deck.id || deck.name}`];
    let currentSection = "";
    deck.cards.forEach((card) => {
      const section = card.section || card.category || "Other";
      if (section !== currentSection) {
        currentSection = section;
        lines.push("", currentSection);
      }
      lines.push(`${card.count} ${card.name}`);
    });
    return lines.join("\n");
  }

  function updateLibraryMeta(library) {
    const eventCount = Object.keys(library?.events || {}).length;
    const deckCount = Object.keys(library?.decks || {}).length;
    const updatedAt = library?.updated_at ? ` · ${new Date(library.updated_at).toLocaleString()}` : "";
    els.libraryMeta.textContent = `${eventCount} environment(s), ${deckCount} deck(s)${updatedAt}`;
  }

  function environmentKey(metadata) {
    return metadata.eventId || metadata.sourceUrl || metadata.eventName || "";
  }

  function environmentName(metadata) {
    return metadata.eventName || metadata.eventId || metadata.sourceUrl || "Unknown environment";
  }

  function buildEnvironmentSummary(decks) {
    const grouped = new Map();
    decks.forEach((deck) => {
      const metadata = deck.metadata;
      const key = metadata ? environmentKey(metadata) : "";
      if (!key) {
        return;
      }
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          name: environmentName(metadata),
          sourceUrl: metadata.sourceUrl || "",
          count: 0,
        });
      }
      grouped.get(key).count += 1;
    });
    return Array.from(grouped.values()).sort(
      (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
    );
  }

  function normalizeEnvironmentSelection(environments) {
    const keys = new Set(environments.map((environment) => environment.key));
    state.selectedEnvironments.forEach((key) => {
      if (!keys.has(key)) {
        state.selectedEnvironments.delete(key);
      }
    });
    if (state.selectedEnvironments.size === keys.size) {
      state.selectedEnvironments.clear();
    }
  }

  function selectedEnvironmentLabel() {
    const environments = buildEnvironmentSummary(state.decks);
    if (!environments.length) {
      return "All decks";
    }
    if (!state.selectedEnvironments.size) {
      return "All environments";
    }
    const names = environments
      .filter((environment) => state.selectedEnvironments.has(environment.key))
      .map((environment) => environment.name);
    if (names.length <= 2) {
      return names.join(", ");
    }
    return `${names.length} environments`;
  }

  function metadataMatchesSelectedEnvironment(metadata) {
    return (
      state.selectedEnvironments.size === 0 ||
      state.selectedEnvironments.has(environmentKey(metadata))
    );
  }

  function deckMatchesSelectedEnvironment(deck) {
    if (!state.selectedEnvironments.size) {
      return true;
    }
    return deck.metadata ? metadataMatchesSelectedEnvironment(deck.metadata) : false;
  }

  function buildArchetypeSummary(decks) {
    const grouped = new Map();
    decks.forEach((deck) => {
      const archetype = deck.metadata?.archetype;
      if (!archetype) {
        return;
      }
      if (!grouped.has(archetype)) {
        grouped.set(archetype, { archetype, decks: [], count: 0 });
      }
      const item = grouped.get(archetype);
      item.decks.push(deck);
      item.count += 1;
    });
    return Array.from(grouped.values()).sort(
      (a, b) => b.count - a.count || a.archetype.localeCompare(b.archetype),
    );
  }

  function scopedDecksForArchetype(decks, selectedArchetype) {
    const taggedDecks = decks.filter((deck) => deck.metadata?.archetype);
    if (selectedArchetype !== "All") {
      const scoped = taggedDecks.filter((deck) => deck.metadata.archetype === selectedArchetype);
      return scoped.length ? scoped : taggedDecks;
    }
    return taggedDecks.length ? taggedDecks : decks;
  }

  function getComparisonDecks() {
    return scopedDecksForArchetype(getEnvironmentFilteredDecks(), state.selectedArchetype);
  }

  function getEnvironmentFilteredDecks() {
    return state.decks.filter(deckMatchesSelectedEnvironment);
  }

  function ensureSelectedArchetype(summary) {
    const values = new Set(["All", ...summary.map((item) => item.archetype)]);
    if (!values.has(state.selectedArchetype)) {
      state.selectedArchetype = "All";
    }
  }

  function comparisonScopeLabel(decks) {
    const environment = selectedEnvironmentLabel();
    if (state.selectedArchetype !== "All") {
      return `${environment} · ${state.selectedArchetype} · ${decks.length} deck(s)`;
    }
    if (state.decks.some((deck) => deck.metadata?.archetype)) {
      return `${environment} · All archetypes · ${decks.length} deck(s)`;
    }
    return `${environment} · ${decks.length} deck(s)`;
  }

  function renderComparisonScopeLabels(decks) {
    const scope = comparisonScopeLabel(decks);
    els.coreCardsScope.textContent = `Cards at or above threshold · ${scope}`;
    els.categorySlotsScope.textContent = `Total card slots · ${scope}`;
    els.matrixScope.textContent = `Counts, adoption, average, and range · ${scope}`;
  }

  function buildCardStats(decks) {
    const byCard = new Map();
    decks.forEach((deck, deckIndex) => {
      deck.cards.forEach((count, key) => {
        if (!byCard.has(key)) {
          byCard.set(key, {
            key,
            name: deck.displayNames.get(key),
            category: deck.categories.get(key) || "Other",
            counts: Array(decks.length).fill(0),
            appearances: 0,
            total: 0,
            min: 0,
            max: 0,
            avg: 0,
            adoption: 0,
          });
        }
        const stat = byCard.get(key);
        stat.counts[deckIndex] = count;
        stat.total += count;
      });
    });

    return Array.from(byCard.values()).map((stat) => {
      const nonZero = stat.counts.filter((count) => count > 0);
      stat.appearances = nonZero.length;
      stat.min = nonZero.length ? Math.min(...nonZero) : 0;
      stat.max = nonZero.length ? Math.max(...nonZero) : 0;
      stat.avg = stat.total / decks.length;
      stat.adoption = decks.length ? stat.appearances / decks.length : 0;
      return stat;
    });
  }

  function sortStats(stats, sortMode) {
    const sorted = [...stats];
    sorted.sort((a, b) => {
      const categoryDiff = categoryRank(a.category) - categoryRank(b.category);
      if (sortMode === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortMode === "category") {
        return (
          categoryDiff ||
          b.adoption - a.adoption ||
          b.avg - a.avg ||
          a.name.localeCompare(b.name)
        );
      }
      if (sortMode === "avg") {
        return (
          b.avg - a.avg ||
          b.adoption - a.adoption ||
          categoryDiff ||
          a.name.localeCompare(b.name)
        );
      }
      return (
        b.adoption - a.adoption ||
        categoryDiff ||
        b.avg - a.avg ||
        a.name.localeCompare(b.name)
      );
    });
    return sorted;
  }

  function categoryRank(category) {
    return CATEGORY_ORDER.has(category) ? CATEGORY_ORDER.get(category) : 99;
  }

  function percentage(value) {
    return `${Math.round(value * 100)}%`;
  }

  function formatAvg(value) {
    return value.toFixed(value % 1 === 0 ? 0 : 1);
  }

  function categoryClass(category) {
    return `cat-${category.toLocaleLowerCase()}`;
  }

  function getFilteredStats(decks = getComparisonDecks()) {
    const stats = buildCardStats(decks);
    const query = state.search.trim().toLocaleLowerCase();
    return sortStats(
      stats.filter((stat) => {
        const categoryMatch =
          state.selectedCategory === "All" || stat.category === state.selectedCategory;
        const searchMatch = !query || stat.name.toLocaleLowerCase().includes(query);
        return categoryMatch && searchMatch;
      }),
      state.sort,
    );
  }

  function renderSummary(stats, decks) {
    const core = stats.filter((stat) => stat.adoption >= state.minAdoption);
    const uniqueCards = buildCardStats(decks).length;
    const avgDeckSize = decks.length
      ? decks.reduce((sum, deck) => sum + deck.totalCards, 0) / decks.length
      : 0;

    els.summary.innerHTML = "";
    [
      ["Decks", decks.length],
      ["Unique cards", uniqueCards],
      ["Core cards", core.length],
      ["Avg. deck size", formatAvg(avgDeckSize)],
    ].forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "metric";
      item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
      els.summary.appendChild(item);
    });
  }

  function renderEventAnalysis() {
    const environmentDecks = getEnvironmentFilteredDecks();
    const summary = buildArchetypeSummary(environmentDecks);
    els.eventAnalysis.hidden = summary.length === 0;
    els.archetypeDistribution.innerHTML = "";
    els.deckMetadata.innerHTML = "";
    renderArchetypeSelect(summary);
    renderArchetypeAdoption();

    if (!summary.length) {
      return;
    }

    const total = summary.reduce((sum, item) => sum + item.count, 0);
    summary.forEach((item) => {
      const row = document.createElement("button");
      row.className = "distribution-row";
      if (state.selectedArchetype === item.archetype) {
        row.classList.add("is-active");
      }
      row.type = "button";
      row.innerHTML = `
        <span>${escapeHtml(item.archetype)}</span>
        <strong>${item.count}</strong>
        <small>${percentage(item.count / total)}</small>
        <span class="distribution-bar"><span style="width: ${(item.count / total) * 100}%"></span></span>
      `;
      row.addEventListener("click", () => {
        state.selectedArchetype = item.archetype;
        render();
      });
      els.archetypeDistribution.appendChild(row);
    });

    const table = document.createElement("table");
    table.className = "metadata-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Deck ID</th>
          <th>Placement</th>
          <th>Archetype</th>
          <th>Environment</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    environmentDecks
      .filter((deck) => deck.metadata)
      .forEach((deck) => {
        const row = document.createElement("tr");
        const sourceUrl = deck.metadata.sourceUrl;
        const eventName = deck.metadata.eventName || deck.metadata.eventId;
        row.innerHTML = `
          <td><code>${escapeHtml(deck.deckId)}</code></td>
          <td>${escapeHtml(deck.metadata.placement)}</td>
          <td>${escapeHtml(deck.metadata.archetype)}</td>
          <td>${
            sourceUrl
              ? `<a href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(eventName)}</a>`
              : escapeHtml(eventName)
          }</td>
        `;
        tbody.appendChild(row);
      });
    els.deckMetadata.appendChild(table);
  }

  function renderArchetypeSelect(summary) {
    ensureSelectedArchetype(summary);
    const currentValues = new Set(["All", ...summary.map((item) => item.archetype)]);
    els.archetypeSelect.innerHTML = "";
    currentValues.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "All" ? "All archetypes" : value;
      els.archetypeSelect.appendChild(option);
    });
    els.archetypeSelect.value = state.selectedArchetype;
  }

  function renderArchetypeAdoption() {
    const environmentDecks = getEnvironmentFilteredDecks();
    const decks =
      state.selectedArchetype === "All"
        ? environmentDecks.filter((deck) => deck.metadata)
        : environmentDecks.filter((deck) => deck.metadata?.archetype === state.selectedArchetype);
    const stats = sortStats(buildCardStats(decks), state.sort);
    els.archetypeAdoptionBody.innerHTML = "";
    els.archetypeScope.textContent = decks.length
      ? `${decks.length} deck(s)`
      : "No environment-tagged decks";

    if (!decks.length || !stats.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5" class="empty">No archetype-scoped data.</td>';
      els.archetypeAdoptionBody.appendChild(row);
      return;
    }

    stats.slice(0, 40).forEach((stat) => {
      const meta = cardMetaForName(stat.name);
      const row = document.createElement("tr");
      row.innerHTML = `
        <th scope="row">${renderCardNameCell(stat, meta)}</th>
        <td><span class="category ${categoryClass(stat.category)}">${stat.category}</span></td>
        <td>${percentage(stat.adoption)}</td>
        <td>${formatAvg(stat.avg)}</td>
        <td>${stat.min}-${stat.max}</td>
      `;
      els.archetypeAdoptionBody.appendChild(row);
    });
  }

  function renderCoreCards(stats) {
    const core = stats.filter((stat) => stat.adoption >= state.minAdoption);

    els.coreCards.innerHTML = "";
    els.coreCards.dataset.viewMode = state.viewMode;
    if (!core.length) {
      els.coreCards.innerHTML = '<p class="empty">No cards meet the current threshold.</p>';
      return;
    }

    core.forEach((stat) => {
      const meta = cardMetaForName(stat.name);
      const linkStart = meta?.officialUrl
        ? `<a href="${escapeAttribute(meta.officialUrl)}" target="_blank" rel="noopener">`
        : "";
      const linkEnd = meta?.officialUrl ? "</a>" : "";
      const image = meta?.imageUrl
        ? `<img src="${escapeAttribute(meta.imageUrl)}" alt="${escapeAttribute(stat.name)}" loading="lazy" />`
        : '<div class="card-image-placeholder" aria-hidden="true"></div>';
      const card = document.createElement("article");
      card.className = "core-card";
      card.innerHTML = `
        <div class="core-card__image">${linkStart}${image}${linkEnd}</div>
        <div>
          <span class="category ${categoryClass(stat.category)}">${stat.category}</span>
          <h3>${linkStart}${escapeHtml(stat.name)}${linkEnd}</h3>
        </div>
        <div class="core-card__stats">
          <span>${percentage(stat.adoption)}</span>
          <small>avg ${formatAvg(stat.avg)} / range ${stat.min}-${stat.max}</small>
        </div>
        <div class="adoption-bar" aria-hidden="true">
          <span style="width: ${stat.adoption * 100}%"></span>
        </div>
      `;
      els.coreCards.appendChild(card);
    });
  }

  function renderCategorySummary(decks) {
    const categories = ["Pokemon", "Trainer", "Energy", "Other"];
    els.categorySummary.innerHTML = "";

    decks.forEach((deck) => {
      const row = document.createElement("div");
      row.className = "deck-category-row";
      const title = document.createElement("strong");
      title.textContent = deck.name;
      row.appendChild(title);

      const bars = document.createElement("div");
      bars.className = "stacked-bars";
      categories.forEach((category) => {
        const total = deck.categoryTotals.get(category) || 0;
        if (!total) {
          return;
        }
        const segment = document.createElement("span");
        segment.className = `stacked-bars__segment ${categoryClass(category)}`;
        segment.style.width = `${(total / deck.totalCards) * 100}%`;
        segment.title = `${category}: ${total}`;
        segment.textContent = total;
        bars.appendChild(segment);
      });
      row.appendChild(bars);
      els.categorySummary.appendChild(row);
    });
  }

  function renderCategoryFilter(decks) {
    const categories = new Set(["All"]);
    buildCardStats(decks).forEach((stat) => categories.add(stat.category));
    els.categoryFilter.innerHTML = "";
    Array.from(categories)
      .sort((a, b) => {
        if (a === "All") {
          return -1;
        }
        if (b === "All") {
          return 1;
        }
        return categoryRank(a) - categoryRank(b) || a.localeCompare(b);
      })
      .forEach((category) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        els.categoryFilter.appendChild(option);
      });
    els.categoryFilter.value = state.selectedCategory;
  }

  function renderEnvironmentFilters() {
    const environments = buildEnvironmentSummary(state.decks);
    normalizeEnvironmentSelection(environments);
    els.environmentFilters.innerHTML = "";
    if (!environments.length) {
      els.environmentFilters.innerHTML = '<span class="empty">No environment metadata.</span>';
      return;
    }

    environments.forEach((environment) => {
      const label = document.createElement("label");
      label.className = "filter-chip";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = environment.key;
      input.checked =
        state.selectedEnvironments.size === 0 ||
        state.selectedEnvironments.has(environment.key);
      input.addEventListener("change", () => {
        const allKeys = environments.map((item) => item.key);
        if (state.selectedEnvironments.size === 0) {
          state.selectedEnvironments = new Set(allKeys);
        }
        if (input.checked) {
          state.selectedEnvironments.add(environment.key);
        } else {
          state.selectedEnvironments.delete(environment.key);
        }
        if (state.selectedEnvironments.size === allKeys.length) {
          state.selectedEnvironments.clear();
        }
        render();
      });
      label.appendChild(input);
      label.append(
        document.createTextNode(environment.name),
        Object.assign(document.createElement("small"), {
          textContent: String(environment.count),
        }),
      );
      els.environmentFilters.appendChild(label);
    });
  }

  function renderMatrix(stats, decks) {
    els.matrixHead.innerHTML = "";
    els.matrixBody.innerHTML = "";

    const headerRow = document.createElement("tr");
    ["Card", "Category", ...decks.map((deck) => deck.name), "Adoption", "Avg", "Range"].forEach(
      (label) => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      },
    );
    els.matrixHead.appendChild(headerRow);

    if (!stats.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = decks.length + 5;
      cell.className = "empty";
      cell.textContent = "No matching cards.";
      row.appendChild(cell);
      els.matrixBody.appendChild(row);
      return;
    }

    stats.forEach((stat) => {
      const meta = cardMetaForName(stat.name);
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.innerHTML = renderCardNameCell(stat, meta);
      row.appendChild(name);

      const category = document.createElement("td");
      category.innerHTML = `<span class="category ${categoryClass(stat.category)}">${stat.category}</span>`;
      row.appendChild(category);

      stat.counts.forEach((count) => {
        const cell = document.createElement("td");
        cell.className = count ? "count count--present" : "count";
        cell.textContent = count || "-";
        row.appendChild(cell);
      });

      [percentage(stat.adoption), formatAvg(stat.avg), `${stat.min}-${stat.max}`].forEach(
        (value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        },
      );
      els.matrixBody.appendChild(row);
    });
  }

  function render() {
    renderEnvironmentFilters();
    const summary = buildArchetypeSummary(getEnvironmentFilteredDecks());
    ensureSelectedArchetype(summary);
    const decks = getComparisonDecks();
    if (state.selectedCategory !== "All") {
      const categories = new Set(buildCardStats(decks).map((stat) => stat.category));
      if (!categories.has(state.selectedCategory)) {
        state.selectedCategory = "All";
      }
    }
    const stats = getFilteredStats(decks);
    document.body.dataset.viewMode = state.viewMode;
    renderSummary(stats, decks);
    renderCategoryFilter(decks);
    renderComparisonScopeLabels(decks);
    renderCoreCards(stats);
    renderCategorySummary(decks);
    renderEventAnalysis();
    renderMatrix(stats, decks);
    els.thresholdValue.textContent = percentage(state.minAdoption);
    els.deckWarning.hidden = state.decks.length > 0;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char];
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(String(value));
  }

  function renderCardNameCell(stat, meta) {
    const image = meta?.imageUrl
      ? `<img src="${escapeAttribute(meta.imageUrl)}" alt="" loading="lazy" />`
      : "";
    const text = meta?.officialUrl
      ? `<a href="${escapeAttribute(meta.officialUrl)}" target="_blank" rel="noopener">${escapeHtml(stat.name)}</a>`
      : escapeHtml(stat.name);
    return `<span class="matrix-card-name">${image}<span>${text}</span></span>`;
  }

  function parseAndRender() {
    state.decks = parseDecks(els.deckInput.value);
    attachDeckMetadata(state.decks, state.deckMetadata);
    render();
  }

  function setFetchStatus(message, kind) {
    els.fetchStatus.textContent = message;
    els.fetchStatus.dataset.kind = kind || "";
  }

  function setEventStatus(message, kind) {
    els.eventStatus.textContent = message;
    els.eventStatus.dataset.kind = kind || "";
  }

  function setLibraryStatus(message, kind) {
    els.libraryStatus.textContent = message;
    els.libraryStatus.dataset.kind = kind || "";
  }

  function canUseServer() {
    return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  }

  async function fetchLibrary() {
    const endpoint = canUseServer() ? "/api/library" : "library.json";
    const response = await fetch(endpoint);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Library load failed.");
    }
    return payload;
  }

  function renderEventRows(rows) {
    els.eventResults.hidden = rows.length === 0;
    els.eventResults.innerHTML = "";
    if (!rows.length) {
      return;
    }

    const table = document.createElement("table");
    table.className = "event-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Placement</th>
          <th>Archetype</th>
          <th>Deck ID</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.placement || "")}</td>
        <td>${escapeHtml(row.archetype || "")}</td>
        <td><code>${escapeHtml(row.deck_id)}</code></td>
      `;
      tbody.appendChild(tr);
    });
    els.eventResults.appendChild(table);
  }

  async function collectEventDecks() {
    const pageUrl = els.eventUrlInput.value.trim();
    if (!pageUrl) {
      setEventStatus("Enter an environment article URL.", "error");
      return;
    }
    if (!canUseServer()) {
      setEventStatus("Environment collection is only available from the local server.", "error");
      return;
    }

    setEventStatus("Collecting...", "loading");
    els.collectEventDecks.disabled = true;
    try {
      const response = await fetch(`/api/event-decks?url=${encodeURIComponent(pageUrl)}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Environment collection failed.");
      }
      state.eventRows = payload.rows || [];
      state.eventInfo = payload.event || null;
      state.deckMetadata = buildDeckMetadataMap(state.eventRows, state.eventInfo);
      els.deckIdInput.value = (payload.ids || []).join("\n");
      renderEventRows(state.eventRows);
      attachDeckMetadata(state.decks, state.deckMetadata);
      render();
      setEventStatus(`Collected ${payload.count} deck ID(s).`, "success");
    } catch (error) {
      setEventStatus(error.message, "error");
      renderEventRows([]);
    } finally {
      els.collectEventDecks.disabled = false;
    }
  }

  async function fetchOfficialDecks() {
    const ids = parseDeckIdInput(els.deckIdInput.value);
    if (!ids.length) {
      setFetchStatus("Enter at least one valid official deck URL or ID.", "error");
      return;
    }

    if (!canUseServer()) {
      setFetchStatus("Official deck fetching is only available from the local server.", "error");
      return;
    }

    setFetchStatus(`Fetching ${ids.length} deck(s)...`, "loading");
    els.fetchDecks.disabled = true;
    try {
      const response = await fetch(`/api/decks?ids=${encodeURIComponent(ids.join(","))}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Deck fetch failed.");
      }
      state.fetchedDecks = (payload.decks || []).map(fetchedDeckToStoredDeck);
      registerDeckPayloadMetadata(state.fetchedDecks);
      els.deckInput.value = payload.text;
      parseAndRender();
      await saveLibrary({ silent: true });
      setFetchStatus(`Loaded ${payload.decks.length} deck(s).`, "success");
    } catch (error) {
      setFetchStatus(error.message, "error");
    } finally {
      els.fetchDecks.disabled = false;
    }
  }

  async function saveLibrary(options = {}) {
    const { silent = false } = options;
    if (!canUseServer()) {
      setLibraryStatus("Saving is only available from the local server.", "error");
      return null;
    }
    if (!state.decks.length && !state.eventRows.length) {
      setLibraryStatus("No current decks or environment metadata to save.", "error");
      return null;
    }

    if (!silent) {
      setLibraryStatus("Saving...", "loading");
    }
    els.saveLibrary.disabled = true;
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLibraryPayload()),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Library save failed.");
      }
      state.library = payload;
      updateLibraryMeta(payload);
      setLibraryStatus("Saved.", "success");
      return payload;
    } catch (error) {
      setLibraryStatus(error.message, "error");
      return null;
    } finally {
      els.saveLibrary.disabled = false;
    }
  }

  async function loadLibrary(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      setLibraryStatus("Loading...", "loading");
    }
    els.loadLibrary.disabled = true;
    try {
      const payload = await fetchLibrary();
      updateLibraryMeta(payload);
      const deckCount = Object.keys(payload.decks || {}).length;
      if (deckCount) {
        restoreLibrary(payload);
        setLibraryStatus(`Loaded ${deckCount} saved deck(s).`, "success");
      } else if (!silent) {
        setLibraryStatus("No saved decks yet.", "success");
      }
      return payload;
    } catch (error) {
      if (!silent) {
        setLibraryStatus(error.message, "error");
      }
      return null;
    } finally {
      els.loadLibrary.disabled = false;
    }
  }

  function copyCsv() {
    const decks = getComparisonDecks();
    const stats = getFilteredStats(decks);
    const headers = ["Card", "Category", ...decks.map((deck) => deck.name), "Adoption", "Avg", "Min", "Max"];
    const rows = stats.map((stat) => [
      stat.name,
      stat.category,
      ...stat.counts,
      percentage(stat.adoption),
      formatAvg(stat.avg),
      stat.min,
      stat.max,
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((value) => String(value).replace(/"/g, '""'))
          .map((value) => `"${value}"`)
          .join(","),
      )
      .join("\n");
    navigator.clipboard.writeText(csv).then(() => {
      els.copyCsv.textContent = "Copied";
      window.setTimeout(() => {
        els.copyCsv.textContent = "Copy CSV";
      }, 1200);
    });
  }

  function bindElements() {
    [
      "eventUrlInput",
      "collectEventDecks",
      "eventStatus",
      "eventResults",
      "deckIdInput",
      "deckInput",
      "fetchDecks",
      "fetchStatus",
      "environmentFilters",
      "saveLibrary",
      "loadLibrary",
      "libraryStatus",
      "libraryMeta",
      "loadSample",
      "clearInput",
      "summary",
      "coreCards",
      "coreCardsScope",
      "categorySummary",
      "categorySlotsScope",
      "eventAnalysis",
      "archetypeDistribution",
      "deckMetadata",
      "archetypeSelect",
      "archetypeScope",
      "archetypeAdoptionBody",
      "matrixHead",
      "matrixBody",
      "matrixScope",
      "threshold",
      "thresholdValue",
      "categoryFilter",
      "search",
      "sort",
      "textView",
      "imageView",
      "copyCsv",
      "deckWarning",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    els.collectEventDecks.addEventListener("click", collectEventDecks);
    els.fetchDecks.addEventListener("click", fetchOfficialDecks);
    els.saveLibrary.addEventListener("click", () => saveLibrary());
    els.loadLibrary.addEventListener("click", () => loadLibrary());
    els.deckInput.addEventListener("input", () => {
      state.fetchedDecks = [];
      parseAndRender();
    });
    els.loadSample.addEventListener("click", () => {
      state.fetchedDecks = [];
      els.deckInput.value = DEFAULT_SAMPLE;
      parseAndRender();
    });
    els.clearInput.addEventListener("click", () => {
      state.fetchedDecks = [];
      els.deckInput.value = "";
      parseAndRender();
    });
    els.threshold.addEventListener("input", () => {
      state.minAdoption = Number(els.threshold.value) / 100;
      render();
    });
    els.categoryFilter.addEventListener("change", () => {
      state.selectedCategory = els.categoryFilter.value;
      render();
    });
    els.search.addEventListener("input", () => {
      state.search = els.search.value;
      render();
    });
    els.sort.addEventListener("change", () => {
      state.sort = els.sort.value;
      render();
    });
    els.archetypeSelect.addEventListener("change", () => {
      state.selectedArchetype = els.archetypeSelect.value;
      render();
    });
    els.textView.addEventListener("click", () => {
      state.viewMode = "text";
      updateViewButtons();
      render();
    });
    els.imageView.addEventListener("click", () => {
      state.viewMode = "image";
      updateViewButtons();
      render();
    });
    els.copyCsv.addEventListener("click", copyCsv);
  }

  function updateViewButtons() {
    const textActive = state.viewMode === "text";
    els.textView.setAttribute("aria-pressed", String(textActive));
    els.imageView.setAttribute("aria-pressed", String(!textActive));
  }

  function init() {
    bindElements();
    bindEvents();
    updateViewButtons();
    els.deckInput.value = DEFAULT_SAMPLE;
    parseAndRender();
    loadLibrary({ silent: true });
  }

  if (typeof module !== "undefined") {
    module.exports = {
      buildCardStats,
      extractDeckId,
      parseCardLine,
      parseDeckIdInput,
      parseDecks,
      registerCardMeta,
      attachDeckMetadata,
      buildArchetypeSummary,
      buildDeckMetadataMap,
      buildLibraryPayload,
      buildEnvironmentSummary,
      normalizeStoredDeck,
      scopedDecksForArchetype,
      sortStats,
    };
  }

  if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", init);
  }
})();
