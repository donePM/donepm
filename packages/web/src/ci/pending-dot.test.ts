// @vitest-environment jsdom
import { createSSRApp, ref, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ItemDetail, ItemView } from "../api/types";

const detail = ref<ItemDetail>();
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { id: "i1" } }) }));
vi.mock("../item/detail", () => ({
  useItemDetail: () => ({ detail, error: ref(), diff: ref(), diffError: ref(), diffLoading: ref(false), reload: vi.fn(), reloadDiff: vi.fn() }),
}));

const { default: ItemCard } = await import("../board/ItemCard.vue");
const { default: CiPanel } = await import("../item/CiPanel.vue");
const { default: ItemDetailView } = await import("../item/ItemDetailView.vue");
const { default: CiPendingDot } = await import("./CiPendingDot.vue");

const DOT = /class="ci-pending-dot[ "]/;

function item(state: string, extra: object = {}): ItemDetail {
  return {
    id: "i1", externalId: "acme/shop#7", externalUrl: "https://github.com/acme/shop/issues/7", title: "Fix it", body: "", state, labels: [], badges: [],
    source: "github", playbook: "default", agent: { running: false }, events: [], drafts: [], asks: [], repo: null, ...extra,
  } as unknown as ItemDetail;
}

async function html(component: Component, props: Record<string, unknown> = {}): Promise<string> {
  const app = createSSRApp(component, props);
  app.component("RouterLink", { template: "<a><slot /></a>" });
  return renderToString(app);
}

describe("CiPendingDot", () => {
  it("is decoration: the text next to it names the state", async () => {
    expect(await html(CiPendingDot)).toMatch(/aria-hidden="true"/);
  });
});

describe("Waiting for CI indicator", () => {
  it("shows on the card of a checking item only", async () => {
    const props = (state: string) => ({ item: item(state) as ItemView, now: 0 });
    expect(await html(ItemCard, props("checking"))).toMatch(DOT);
    for (const state of ["ready", "running", "needs_you", "done"]) expect(await html(ItemCard, props(state))).not.toMatch(DOT);
  });

  it("shows in the CI panel while waiting, not when CI failed", async () => {
    const waiting = await html(CiPanel, { item: item("checking") });
    expect(waiting).toMatch(DOT);
    expect(waiting).toContain("Waiting for CI");
    const failed = item("needs_you", { attention: { kind: "ci_failed", failed: [], logs: [], runs: [] } });
    expect(await html(CiPanel, { item: failed })).not.toMatch(DOT);
  });

  it("shows in the state badge of a checking item only", async () => {
    detail.value = item("checking");
    expect(await html(ItemDetailView)).toMatch(DOT);
    detail.value = item("running");
    expect(await html(ItemDetailView)).not.toMatch(DOT);
  });
});
