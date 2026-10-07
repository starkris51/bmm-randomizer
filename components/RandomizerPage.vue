<script lang="ts" setup>
import {
  ContributorApi,
  TrackApi,
  TrackCollectionApi,
  TrackSubtype,
} from "@bcc-code/bmm-sdk-fetch";
import type { TrackGetRequest, TrackModel } from "@bcc-code/bmm-sdk-fetch";
import { toast } from "vue-sonner";

const { setQueue } = useNuxtApp().$mediaPlayer;
const origin = "Randomizer";
const loading = ref(false);

const randomInt = (max: number) => Math.floor(Math.random() * max);

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function findCount(
  probe: (from: number) => Promise<unknown[]>,
): Promise<number> {
  const hasItemAt = (from: number) =>
    probe(from).then(
      (items) => items.length > 0,
      () => false,
    );

  if (!(await hasItemAt(0))) return 0;
  let lo = 0;
  let hi = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await hasItemAt(hi)) {
    lo = hi;
    hi *= 2;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    // eslint-disable-next-line no-await-in-loop
    if (await hasItemAt(mid)) lo = mid;
    else hi = mid;
  }
  return lo + 1;
}

// Caches counts in localStorage so findCount only runs once a day per filter.
const COUNT_TTL_MS = 24 * 60 * 60 * 1000;
const storageKey = (key: string) => `randomizer-count:${key}`;

function readCachedCount(key: string): number | null {
  try {
    const cached = JSON.parse(localStorage.getItem(storageKey(key)) ?? "null");
    if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.count;
  } catch {}
  return null;
}

function writeCachedCount(key: string, count: number) {
  try {
    localStorage.setItem(
      storageKey(key),
      JSON.stringify({ count, at: Date.now() }),
    );
  } catch {}
}

type TrackFilter = Omit<TrackGetRequest, "from" | "size">;

const filter = reactive({
  contentTypes: [] as TrackSubtype[],
  hasTranscription: "" as "" | "true" | "false",
});

const trackFilter = computed<TrackFilter>(() => {
  const f: TrackFilter = {};
  if (filter.contentTypes.length)
    f.contentType2 = [...filter.contentTypes].sort();
  if (filter.hasTranscription)
    f.hasTranscription = filter.hasTranscription === "true";
  return f;
});
const filterKey = computed(() => JSON.stringify(trackFilter.value));

function matchesFilter(track: TrackModel, f: TrackFilter): boolean {
  if (f.contentType2 && !f.contentType2.includes(track.subtype)) return false;
  if (
    f.hasTranscription !== undefined &&
    Boolean(track.hasTranscription) !== f.hasTranscription
  )
    return false;
  return true;
}

const contentTypeOptions = Object.values(TrackSubtype);
const maxTracks = 50;

function toggleContentType(type: TrackSubtype) {
  const i = filter.contentTypes.indexOf(type);
  if (i === -1) filter.contentTypes.push(type);
  else filter.contentTypes.splice(i, 1);
}

const { data: contributors, pending: contributorsPending } = useContributors();
const sortedContributors = computed(() =>
  [...(contributors.value ?? [])].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  ),
);
// One contributor list per selected content type, or a single untyped list
// (type null) when no content type is selected.
type ContributorGroup = { type: TrackSubtype | null; contributorIds: number[] };
const contributorGroups = ref<ContributorGroup[]>([
  { type: null, contributorIds: [] },
]);

watch(
  () => [...filter.contentTypes],
  (types) => {
    const groupTypes: (TrackSubtype | null)[] = types.length ? types : [null];
    contributorGroups.value = groupTypes.map(
      (type) =>
        contributorGroups.value.find((g) => g.type === type) ?? {
          type,
          contributorIds: [],
        },
    );
  },
);

// Every selected contributor across all groups.
const contributorIds = computed(() => [
  ...new Set(contributorGroups.value.flatMap((g) => g.contributorIds)),
]);

const contributorById = (id: number) =>
  sortedContributors.value.find((c) => c.id === id) ?? { id, name: null };

const groupContributors = (group: ContributorGroup) =>
  group.contributorIds.map(contributorById);

const availableContributors = (group: ContributorGroup) =>
  sortedContributors.value.filter(
    (c) => !group.contributorIds.includes(c.id),
  );

function addContributor(group: ContributorGroup, id: number) {
  if (!group.contributorIds.includes(id)) group.contributorIds.push(id);
}

function removeContributor(group: ContributorGroup, id: number) {
  group.contributorIds = group.contributorIds.filter((c) => c !== id);
}

// The "add contributor" select resets to its placeholder after each pick.
function onContributorSelect(group: ContributorGroup, event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = Number(select.value);
  if (select.value !== "" && !Number.isNaN(id)) addContributor(group, id);
  select.value = "";
}

function pickRandomContributor(group: ContributorGroup) {
  const list = availableContributors(group);
  if (list.length > 0) addContributor(group, list[randomInt(list.length)]!.id);
}

const fromDate = ref<string | null>(null);
const toDate = ref<string | null>(null);

// The API can't filter by publish date, so it's applied client-side to random picks.
type DateRange = { from: Date | null; to: Date | null };
const dateRange = computed<DateRange | null>(() => {
  if (!fromDate.value && !toDate.value) return null;
  return {
    from: fromDate.value ? new Date(`${fromDate.value}T00:00:00`) : null,
    to: toDate.value ? new Date(`${toDate.value}T23:59:59.999`) : null,
  };
});

function inDateRange(track: TrackModel, range: DateRange | null): boolean {
  if (!range) return true;
  const published = track.publishedAt.getTime();
  if (range.from && published < range.from.getTime()) return false;
  if (range.to && published > range.to.getTime()) return false;
  return true;
}

// When a date range is set without contributors, keep sampling the catalog
// until we've made this many requests (or found enough tracks).
const MAX_DATE_ATTEMPTS = 150;
// Stop early once this many rounds in a row turn up nothing new.
const MAX_STALE_BATCHES = 10;
// Requests sent in parallel per round when sampling the whole catalog.
const CATALOG_PROBES_PER_ROUND = 10;
// Tracks fetched per request, starting at a random offset.
const CATALOG_PROBE_SIZE = 100;

const trackCount = ref<number | null>(null);
watch(
  filterKey,
  (key) => {
    trackCount.value = import.meta.client ? readCachedCount(key) : null;
  },
  { immediate: true },
);

const size = ref(1);

async function randomCatalogTracks(
  params: TrackFilter = trackFilter.value,
): Promise<TrackModel[]> {
  const key = JSON.stringify(params);

  let count = readCachedCount(key);
  if (count === null) {
    count = await findCount((from) =>
      new TrackApi().trackGet({ ...params, from, size: 1 }),
    );
    writeCachedCount(key, count);
  }
  if (filterKey.value === key) trackCount.value = count;
  if (count === 0) return [];

  const total = count;
  const randomTrack = () =>
    new TrackApi().trackGet({
      ...params,
      from: randomInt(total),
      size: 1,
    });

  const range = dateRange.value;
  if (!range) {
    const results = await Promise.all(
      Array.from({ length: size.value }, randomTrack),
    );
    return results.flat();
  }

  // Fetch blocks of tracks at random offsets in parallel rounds, keeping only
  // tracks in the range.
  const randomBlock = () =>
    new TrackApi().trackGet({
      ...params,
      from: randomInt(Math.max(1, total - CATALOG_PROBE_SIZE + 1)),
      size: CATALOG_PROBE_SIZE,
    });

  const found = new Map<number, TrackModel>();
  async function probeRound(attempts: number, stale: number): Promise<void> {
    if (
      attempts >= MAX_DATE_ATTEMPTS ||
      stale >= MAX_STALE_BATCHES ||
      found.size >= size.value
    )
      return;

    const n = Math.min(CATALOG_PROBES_PER_ROUND, MAX_DATE_ATTEMPTS - attempts);
    const before = found.size;
    const results = await Promise.all(Array.from({ length: n }, randomBlock));
    results
      .flat()
      .filter((track) => inDateRange(track, range))
      .forEach((track) => found.set(track.id, track));

    await probeRound(attempts + n, found.size > before ? 0 : stale + 1);
  }

  await probeRound(0, 0);
  // Matches from one block sit next to each other, so shuffle before picking.
  return shuffle([...found.values()]).slice(0, size.value);
}
const CONTRIBUTOR_PAGE_SIZE = 1000;

// A contributor's full track list, fetched once per session.
const contributorTracksCache = new Map<number, Promise<TrackModel[]>>();

async function fetchAllContributorTracks(id: number): Promise<TrackModel[]> {
  const tracks: TrackModel[] = [];

  // Page until an empty page, since the API may cap `size` below what we ask for.
  async function fetchPage(from: number): Promise<void> {
    const page = await new ContributorApi().contributorIdTrackGet({
      id,
      from,
      size: CONTRIBUTOR_PAGE_SIZE,
    });
    if (page.length === 0) return;
    tracks.push(...page);
    await fetchPage(from + page.length);
  }

  await fetchPage(0);
  return tracks;
}

function contributorTracks(id: number): Promise<TrackModel[]> {
  let cached = contributorTracksCache.get(id);
  if (!cached) {
    cached = fetchAllContributorTracks(id);
    cached.catch(() => contributorTracksCache.delete(id));
    contributorTracksCache.set(id, cached);
  }
  return cached;
}

async function randomContributorTracks(
  id: number,
  params: TrackFilter,
): Promise<TrackModel[]> {
  const range = dateRange.value;
  const tracks = await contributorTracks(id);
  return tracks.filter(
    (track) => matchesFilter(track, params) && inDateRange(track, range),
  );
}

// The shared filters narrowed to the group's content type.
function groupFilter(group: ContributorGroup): TrackFilter {
  const params = trackFilter.value;
  return group.type ? { ...params, contentType2: [group.type] } : params;
}

// Pools of candidate tracks for one group: one per contributor, or a single
// catalog sample of the group's type when it has no contributors.
async function groupPools(group: ContributorGroup): Promise<TrackModel[][]> {
  const params = groupFilter(group);
  const pools = group.contributorIds.length
    ? await Promise.all(
        group.contributorIds.map((id) => randomContributorTracks(id, params)),
      )
    : [await randomCatalogTracks(params)];
  return pools.map((pool) => shuffle(pool)).filter((pool) => pool.length > 0);
}

// Each pick chooses a group, then a pool within it, so every content type
// (and every contributor within a type) is equally likely to come up.
async function randomGroupedTracks(
  groups: ContributorGroup[],
): Promise<TrackModel[]> {
  const remaining = (await Promise.all(groups.map(groupPools))).filter(
    (pools) => pools.length > 0,
  );

  const tracklist = new Map<number, TrackModel>();
  while (tracklist.size < size.value && remaining.length > 0) {
    const gi = randomInt(remaining.length);
    const pools = remaining[gi]!;
    const pi = randomInt(pools.length);
    const pool = pools[pi]!;
    const track = pool.pop()!;
    tracklist.set(track.id, track);
    if (pool.length === 0) pools.splice(pi, 1);
    if (pools.length === 0) remaining.splice(gi, 1);
  }
  return [...tracklist.values()];
}

const lastTracks = ref<TrackModel[]>([]);
const lastPlaylistName = ref("");
const savedPlaylistId = ref<number | null>(null);
const saving = ref(false);

function playlistName() {
  const contributorNames = (group: ContributorGroup) =>
    groupContributors(group)
      .map((c) => c.name ?? `#${c.id}`)
      .join(", ");
  const source = contributorGroups.value
    .map((group) => {
      const names = contributorNames(group);
      if (!group.type) return names || "Anything";
      return names ? `${group.type} (${names})` : group.type;
    })
    .join(", ");
  const dates =
    fromDate.value || toDate.value
      ? ` ${fromDate.value || "…"} – ${toDate.value || "…"}`
      : "";
  return `Random: ${source}${dates} (${new Date().toLocaleString()})`;
}

async function playRandom() {
  loading.value = true;
  try {
    if (size.value > maxTracks) size.value = maxTracks;

    const groups = contributorGroups.value.map((g) => ({
      type: g.type,
      contributorIds: [...g.contributorIds],
    }));
    // Without any contributors, one catalog query over all selected types.
    const tracks = shuffle(
      contributorIds.value.length === 0
        ? await randomCatalogTracks()
        : await randomGroupedTracks(groups),
    );

    if (tracks.length === 0) {
      console.warn("[Randomizer] no tracks returned", {
        ...trackFilter.value,
        contributorGroups: groups,
      });
      return;
    }
    setQueue(tracks, 0, origin);
    lastTracks.value = tracks;
    lastPlaylistName.value = playlistName();
    savedPlaylistId.value = null;
  } catch (e) {
    console.error("[Randomizer] failed to get random tracks", e);
  } finally {
    loading.value = false;
  }
}

async function saveAsPlaylist() {
  if (lastTracks.value.length === 0 || savedPlaylistId.value !== null) return;

  saving.value = true;
  try {
    const id = await new TrackCollectionApi().trackCollectionPost({
      createTrackCollectionCommand: {
        name: lastPlaylistName.value,
        trackReferences: tracksToTrackReferences(lastTracks.value),
      },
    });
    savedPlaylistId.value = id;
    refreshPrivatePlaylists();
    toast.success(`Saved "${lastPlaylistName.value}"`, {
      action: {
        label: "Open",
        onClick: () =>
          navigateTo({ name: "playlist-private-id", params: { id } }),
      },
    });
  } catch (e) {
    console.error("[Randomizer] failed to create playlist", e);
    toast.error("Could not create playlist");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex grow flex-col items-center justify-center gap-8 p-6">
    <form
      class="flex w-full max-w-xl flex-col gap-4 rounded-2xl bg-background-2 p-6"
      @submit.prevent="playRandom"
    >
      <label class="type-title-1 text-center text-label-1">Control Panel</label>
      <fieldset class="flex flex-col gap-2">
        <legend class="type-subtitle-2 mb-3 text-label-4">Content type</legend>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="type in contentTypeOptions"
            :key="type"
            type="button"
            class="type-subtitle-2 rounded-full border px-2 py-1 capitalize"
            :class="
              filter.contentTypes.includes(type)
                ? 'border-transparent bg-brand text-on-brand'
                : 'text-pretty border-label-separator'
            "
            @click="toggleContentType(type)"
          >
            {{ type }}
          </button>
        </div>
      </fieldset>

      <div
        v-for="group in contributorGroups"
        :key="group.type ?? 'any'"
        class="flex flex-col gap-1"
      >
        <label
          :for="`randomizer-contributor-${group.type ?? 'any'}`"
          class="type-subtitle-2 capitalize text-label-3"
        >
          {{ group.type ? `${group.type} contributors` : "Contributors" }}
        </label>
        <div class="flex gap-2">
          <select
            :id="`randomizer-contributor-${group.type ?? 'any'}`"
            value=""
            :disabled="contributorsPending"
            class="min-w-0 grow rounded-md bg-background-1 px-2 py-1 text-label-1"
            @change="onContributorSelect(group, $event)"
          >
            <option value="">
              {{
                contributorsPending
                  ? "Loading…"
                  : group.contributorIds.length
                    ? "Add another…"
                    : "Any"
              }}
            </option>
            <option
              v-for="contributor in availableContributors(group)"
              :key="contributor.id"
              :value="contributor.id"
            >
              {{ contributor.name ?? `#${contributor.id}` }}
            </option>
          </select>
          <ButtonStyled
            type="button"
            size="small"
            icon="icon.shuffle"
            :disabled="availableContributors(group).length === 0"
            @click="pickRandomContributor(group)"
          >
            Random
          </ButtonStyled>
        </div>
        <div v-if="group.contributorIds.length" class="flex flex-wrap gap-2">
          <button
            v-for="contributor in groupContributors(group)"
            :key="contributor.id"
            type="button"
            class="border-transparent type-subtitle-2 rounded-full border bg-brand px-2 py-1 text-on-brand"
            :title="`Remove ${contributor.name ?? `#${contributor.id}`}`"
            @click="removeContributor(group, contributor.id)"
          >
            {{ contributor.name ?? `#${contributor.id}` }} ×
          </button>
          <button
            v-if="group.contributorIds.length > 1"
            type="button"
            class="type-subtitle-2 rounded-full border border-label-separator px-2 py-1"
            @click="group.contributorIds = []"
          >
            Clear
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="type-subtitle-2 text-label-3">Transcription</span>
          <select
            v-model="filter.hasTranscription"
            class="rounded-md bg-background-1 px-2 py-1 text-label-1"
          >
            <option value="">Any</option>
            <option value="true">Has transcription</option>
            <option value="false">No transcription</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="type-subtitle-2 text-label-3">Tracks per click</span>
          <input
            v-model.number="size"
            type="number"
            min="1"
            max="100"
            class="rounded-md bg-background-1 px-2 py-1 text-label-1"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="type-subtitle-2 text-label-3">From date</span>
          <input
            v-model="fromDate"
            type="date"
            :max="toDate || undefined"
            class="rounded-md bg-background-1 px-2 py-1 text-label-1"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="type-subtitle-2 text-label-3">To date</span>
          <input
            v-model="toDate"
            type="date"
            :min="fromDate || undefined"
            class="rounded-md bg-background-1 px-2 py-1 text-label-1"
          />
        </label>
      </div>

      <p class="type-subtitle-2 text-label-3">
        <template v-if="contributorIds.length && contributorGroups.length > 1">
          Content types are mixed evenly: each uses its own contributors, or
          the whole catalog when it has none
        </template>
        <template v-else-if="contributorIds.length > 1">
          Random tracks from these {{ contributorIds.length }} contributors,
          shuffled together, that match the filters
        </template>
        <template v-else-if="contributorIds.length === 1">
          Random tracks from this contributor that match the filters
        </template>
        <template v-else-if="trackCount !== null">
          {{ trackCount }} tracks match
          <template v-if="dateRange">
            before the date filter (samples up to
            {{ MAX_DATE_ATTEMPTS * CATALOG_PROBE_SIZE }} tracks)
          </template>
        </template>
        <template v-else>Count is computed on the first click</template>
      </p>
    </form>

    <div class="flex flex-wrap items-center justify-center gap-3">
      <ButtonStyled
        intent="primary"
        size="large"
        icon="icon.shuffle"
        :loading="loading"
        :disabled="loading"
        @click="playRandom"
      >
        Randomize
      </ButtonStyled>
      <ButtonStyled
        v-if="lastTracks.length > 0"
        size="large"
        :icon="savedPlaylistId === null ? 'icon.add' : 'icon.checkmark'"
        :loading="saving"
        :disabled="saving || loading || savedPlaylistId !== null"
        @click="saveAsPlaylist"
      >
        {{ savedPlaylistId === null ? "Save as playlist" : "Saved" }}
      </ButtonStyled>
    </div>
  </div>
</template>
