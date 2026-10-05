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
  contentTypes: [TrackSubtype.Speech] as TrackSubtype[],
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
const contributorId = ref<number | null>(null);

function pickRandomContributor() {
  const list = sortedContributors.value;
  if (list.length > 0) contributorId.value = list[randomInt(list.length)]!.id;
}

const trackCount = ref<number | null>(null);
watch(
  filterKey,
  (key) => {
    trackCount.value = import.meta.client ? readCachedCount(key) : null;
  },
  { immediate: true },
);

const size = ref(1);

async function randomCatalogTracks(): Promise<TrackModel[]> {
  const key = filterKey.value;
  const params = trackFilter.value;

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
  const results = await Promise.all(
    Array.from({ length: size.value }, () =>
      new TrackApi().trackGet({
        ...params,
        from: randomInt(total),
        size: 1,
      }),
    ),
  );
  return results.flat();
}
const CONTRIBUTOR_BATCH_SIZE = 50;
const MAX_CONTRIBUTOR_ATTEMPTS = 10;
async function randomContributorTracks(id: number): Promise<TrackModel[]> {
  const params = trackFilter.value;
  const found = new Map<number, TrackModel>();

  for (
    let attempt = 0;
    attempt < MAX_CONTRIBUTOR_ATTEMPTS && found.size < size.value;
    attempt++
  ) {
    const batch = await new ContributorApi().contributorIdRandomGet({
      id,
      size: CONTRIBUTOR_BATCH_SIZE,
    });
    batch
      .filter((track) => matchesFilter(track, params))
      .forEach((track) => found.set(track.id, track));
    if (batch.length < CONTRIBUTOR_BATCH_SIZE) break;
  }
  return [...found.values()].slice(0, size.value);
}

const lastTracks = ref<TrackModel[]>([]);
const lastPlaylistName = ref("");
const savedPlaylistId = ref<number | null>(null);
const saving = ref(false);

function playlistName() {
  const contributor = sortedContributors.value.find(
    (c) => c.id === contributorId.value,
  );
  const source =
    contributor?.name ?? (filter.contentTypes.join(", ") || "Anything");
  return `Random: ${source} (${new Date().toLocaleString()})`;
}

async function playRandom() {
  loading.value = true;
  try {
    const tracks =
      contributorId.value === null
        ? await randomCatalogTracks()
        : await randomContributorTracks(contributorId.value);
    if (tracks.length === 0) {
      console.warn("[Randomizer] no tracks returned", {
        ...trackFilter.value,
        contributorId: contributorId.value,
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

      <label class="flex flex-col gap-1">
        <span class="type-subtitle-2 text-label-3">Contributor</span>
        <div class="flex gap-2">
          <select
            v-model="contributorId"
            :disabled="contributorsPending"
            class="min-w-0 grow rounded-md bg-background-1 px-2 py-1 text-label-1"
          >
            <option :value="null">
              {{ contributorsPending ? "Loading…" : "Any" }}
            </option>
            <option
              v-for="contributor in sortedContributors"
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
            :disabled="sortedContributors.length === 0"
            @click="pickRandomContributor"
          >
            Random
          </ButtonStyled>
        </div>
      </label>

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
      </div>

      <p class="type-subtitle-2 text-label-3">
        <template v-if="contributorId !== null">
          Random tracks from this contributor that match the filters
        </template>
        <template v-else-if="trackCount !== null">
          {{ trackCount }} tracks match
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
