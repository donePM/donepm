import type { TicketSourceConfig } from "../config/ticket-sources.js";
import { boardsAz, boardsHttp } from "../test-support/azure-boards.js";
import { ticketSourceContract, type TicketSourceScenarios } from "../test-support/contracts/ticket-source.js";
import { fail, fakeExec } from "../test-support/fake-exec.js";
import { fakeHttp, status } from "../test-support/fake-http.js";
import { memoryTokens } from "../test-support/fake-tokens.js";
import { azureBoards } from "./boards.js";
import { azureApiTransport, azureCliTransport } from "./transport.js";

const entries = (): TicketSourceConfig[] => [{ connection: "ado", project: "Platform", repos: ["github.com/acme/widgets"] }];
const board = { id: "ado", organization: "acme" };

const shared: Omit<TicketSourceScenarios, "answering" | "failing"> = {
  ticket: { externalId: "ado:1234", origin: "github.com/acme/widgets" },
  origin: "dev.azure.com/acme/platform/legacy",
  query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS 'auth'",
  // Task 1250 is in a state of the Completed category, so it is left out.
  collected: ["Platform#1234", "Platform#1240"],
};

ticketSourceContract("Azure Boards through az", {
  ...shared,
  answering: () => azureBoards(azureCliTransport(boardsAz(), "acme"), board, entries),
  failing: () => azureBoards(azureCliTransport(fakeExec({ az: fail("ERROR: Please run 'az login' to setup account.") }), "acme"), board, entries),
});

ticketSourceContract("Azure Boards through its REST API", {
  ...shared,
  answering: () => azureBoards(azureApiTransport(boardsHttp(), "acme", memoryTokens({ ado: "pat" }), "ado"), board, entries),
  failing: () => {
    const refused = fakeHttp({ "GET /acme": status(401), "POST /acme": status(401), "PATCH /acme": status(401) });
    return azureBoards(azureApiTransport(refused, "acme", memoryTokens({ ado: "pat" }), "ado"), board, entries);
  },
});
