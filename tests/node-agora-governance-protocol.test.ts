import test from "node:test";
import assert from "node:assert/strict";
import {createHash, generateKeyPairSync, sign, verify, type KeyObject} from "node:crypto";
import {
  AGORA_PARTICIPATION_ROLES,
  AGORA_GOVERNANCE_BALLOT_FORMAT,
  AGORA_GOVERNANCE_DECISION_FORMAT,
  AGORA_PR2_MEMBERSHIP_FORMAT,
  AGORA_PR3_MANDATE_RECORD_FORMAT,
  AGORA_PR3_MAX_MANDATE_MS,
  evaluateGovernanceDecision,
  governanceBallotMessage,
  governanceDecisionDigest,
  governanceElectorateSnapshotId,
  isPr3EligiblePr2,
  parseGovernanceDecisionEnvelope,
  pr3MandateRecordDigest,
  validatePr3MandateTransition,
  type GovernanceBallot,
  type GovernanceDecisionClass,
  type GovernanceDecisionEnvelope,
  type GovernanceElector,
  type Pr2MembershipProof,
  type Pr3MandateRecord,
} from "../app/platform/agora-governance-protocol";

const digest = (value: string): `sha256:${string}` => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const signaturePlaceholder = "A".repeat(86);

type TestElector = GovernanceElector & {privateKey: KeyObject; publicKey: KeyObject};

function electors(prefix: string, count: number): TestElector[] {
  return Array.from({length: count}, (_, index) => {
    const id = `${prefix}:${String(index + 1).padStart(2, "0")}`;
    const {privateKey, publicKey} = generateKeyPairSync("ed25519");
    return {id, keyId: digest(publicKey.export({type: "spki", format: "der"}).toString("base64")), privateKey, publicKey};
  });
}

async function envelope(decisionClass: GovernanceDecisionClass, members: TestElector[], nodes: TestElector[] = []): Promise<GovernanceDecisionEnvelope> {
  const memberActors = members.map(({id, keyId}) => ({id, keyId}));
  const nodeActors = nodes.map(({id, keyId}) => ({id, keyId}));
  return {
    format: AGORA_GOVERNANCE_DECISION_FORMAT,
    protocolVersion: 1,
    networkId: "agoranode:test",
    scope: {kind: decisionClass.startsWith("federation") || decisionClass.startsWith("pr3-") || decisionClass === "protocol-change" ? "federation" : "instance", id: decisionClass.startsWith("federation") || decisionClass.startsWith("pr3-") || decisionClass === "protocol-change" ? "agoranode" : "polisrossa"},
    decisionClass,
    sequence: 7,
    baseCheckpointId: digest("checkpoint:6"),
    proposalSha256: digest("proposal:7"),
    proposalPath: "/polisrossa?view=partecipa&topic=proposal-7",
    opensAt: 1_800_000_000_000,
    closesAt: 1_800_003_600_000,
    appealClosesAt: 1_800_090_000_000,
    electorates: {
      members: {snapshotId: await governanceElectorateSnapshotId("members", memberActors), actors: memberActors},
      nodes: nodes.length ? {snapshotId: await governanceElectorateSnapshotId("nodes", nodeActors), actors: nodeActors} : null,
    },
  };
}

async function ballot(source: GovernanceDecisionEnvelope, elector: TestElector, chamber: "members" | "nodes", choice: "yes" | "no" | "abstain", mandate: `sha256:${string}` | null = null): Promise<GovernanceBallot> {
  const unsigned = {
    format: AGORA_GOVERNANCE_BALLOT_FORMAT,
    protocolVersion: 1 as const,
    decisionDigest: await governanceDecisionDigest(source),
    chamber,
    voterId: elector.id,
    choice,
    keyId: elector.keyId,
    mandateDecisionDigest: mandate,
  };
  return {...unsigned, signature: sign(null, governanceBallotMessage({...unsigned, signature: signaturePlaceholder}), elector.privateKey).toString("base64url")};
}

function verifiers(electorList: TestElector[]) {
  const keys = new Map<string, KeyObject>(electorList.map(elector => [elector.keyId, elector.publicKey]));
  return {
    verifySignature: ({keyId, signature, message}: {keyId: string; signature: string; message: Uint8Array}) => {
      const key = keys.get(keyId);
      return Boolean(key && verify(null, message, key, Buffer.from(signature, "base64url")));
    },
  };
}

test("a closed instance decision produces a deterministic certificate without host voting power", async () => {
  const members = electors("member", 5), decision = await envelope("instance-ordinary", members);
  const ballots = await Promise.all([ballot(decision, members[0], "members", "yes"), ballot(decision, members[1], "members", "yes")]);
  const certificate = await evaluateGovernanceDecision(decision, ballots, {now: decision.closesAt, ...verifiers(members)});
  assert.equal(certificate.outcome, "approved");
  assert.deepEqual(certificate.chambers.members, {eligible: 5, turnout: 2, quorumRequired: 2, yes: 2, no: 0, abstain: 0, approvalRequired: 2, quorumReached: true, approved: true});
  assert.equal(certificate.chambers.nodes, null);
  assert.equal(certificate.baseCheckpointId, decision.baseCheckpointId);
  assert.match(certificate.ballotsSha256, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(certificate), /host|capacity|stake|token/i);
});

test("the contract rejects unknown authority fields, unfrozen rosters and double votes", async () => {
  const members = electors("member", 5), decision = await envelope("instance-ordinary", members);
  assert.throws(() => parseGovernanceDecisionEnvelope({...decision, hostWeight: 100}), /unknown or missing fields/);
  const changedRoster = structuredClone(decision);
  changedRoster.electorates.members.actors = changedRoster.electorates.members.actors.slice(0, 4);
  await assert.rejects(evaluateGovernanceDecision(changedRoster, [], {now: decision.closesAt, ...verifiers(members)}), /electorate digest does not match/);
  const one = await ballot(decision, members[0], "members", "yes");
  await assert.rejects(evaluateGovernanceDecision(decision, [one, one], {now: decision.closesAt, ...verifiers(members)}), /more than once/);
});

test("ballots fail closed for a wrong decision, ineligible key or bad Ed25519 signature", async () => {
  const members = electors("member", 5), outsider = electors("outsider", 1)[0], decision = await envelope("instance-ordinary", members);
  const valid = await ballot(decision, members[0], "members", "yes");
  await assert.rejects(evaluateGovernanceDecision(decision, [{...valid, decisionDigest: digest("another-decision")}], {now: decision.closesAt, ...verifiers(members)}), /different decision/);
  const outsiderBallot = await ballot(decision, outsider, "members", "yes");
  await assert.rejects(evaluateGovernanceDecision(decision, [outsiderBallot], {now: decision.closesAt, ...verifiers([...members, outsider])}), /not in the frozen electorate/);
  await assert.rejects(evaluateGovernanceDecision(decision, [{...valid, signature: "B".repeat(86)}], {now: decision.closesAt, ...verifiers(members)}), /signature verification failed/);
});

test("a protocol change needs both member and node chambers and every node vote needs a local mandate", async () => {
  const members = electors("member", 7), nodes = electors("node", 3), decision = await envelope("protocol-change", members, nodes);
  const memberBallots = await Promise.all(members.slice(0, 5).map(elector => ballot(decision, elector, "members", "yes")));
  const withoutNodes = await evaluateGovernanceDecision(decision, memberBallots, {now: decision.closesAt, ...verifiers([...members, ...nodes]), verifyNodeMandate: () => true});
  assert.equal(withoutNodes.outcome, "no-quorum");
  const nodeBallots = await Promise.all(nodes.slice(0, 2).map((elector, index) => ballot(decision, elector, "nodes", "yes", digest(`node-mandate:${index}`))));
  const approved = await evaluateGovernanceDecision(decision, [...memberBallots, ...nodeBallots], {now: decision.closesAt, ...verifiers([...members, ...nodes]), verifyNodeMandate: () => true});
  assert.equal(approved.outcome, "approved");
  assert.equal(approved.chambers.nodes?.yes, 2);
  await assert.rejects(evaluateGovernanceDecision(decision, [...memberBallots, ...nodeBallots], {now: decision.closesAt, ...verifiers([...members, ...nodes]), verifyNodeMandate: () => false}), /not backed by a verified local mandate/);
});

test("quorum, abstention and ties are derived instead of asserted by a host", async () => {
  const members = electors("member", 5), decision = await envelope("instance-ordinary", members);
  const noQuorum = await evaluateGovernanceDecision(decision, [await ballot(decision, members[0], "members", "yes")], {now: decision.closesAt, ...verifiers(members)});
  assert.equal(noQuorum.outcome, "no-quorum");
  const tied = await evaluateGovernanceDecision(decision, [await ballot(decision, members[0], "members", "yes"), await ballot(decision, members[1], "members", "no")], {now: decision.closesAt, ...verifiers(members)});
  assert.equal(tied.outcome, "tied");
  const abstained = await evaluateGovernanceDecision(decision, [await ballot(decision, members[0], "members", "yes"), await ballot(decision, members[1], "members", "abstain")], {now: decision.closesAt, ...verifiers(members)});
  assert.equal(abstained.chambers.members?.quorumReached, true);
  assert.equal(abstained.outcome, "rejected");
});

test("PR1 personal rights, node PR2 and derived Agora PR3 never gain votes from hosting", () => {
  assert.deepEqual(AGORA_PARTICIPATION_ROLES.PR1, {scope: "personal", nodeBallotWeight: 0, federationElectionWeight: 0, delegateBallotWeight: 0, elected: false, hostingWeight: 0});
  assert.equal(AGORA_PARTICIPATION_ROLES.PR2.nodeBallotWeight, 1);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR2.federationElectionWeight, 1);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR2.federationDeduplication, "one-person-across-nodes");
  assert.equal(AGORA_PARTICIPATION_ROLES.PR2.hostingWeight, 0);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.requires, "active-agora-pr2");
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.sourceNodeId,"agora");
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.nodeBallotWeight,1);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.elected,false);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.delegateBallotWeight, 0);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.hostingWeight, 0);
  assert.equal(AGORA_PARTICIPATION_ROLES.PR3.scope, "platform-via-agora");
});

test("an active PR2 membership from any node is eligible for PR3 candidacy, but pending or expired membership is not", () => {
  const membership: Pr2MembershipProof = {
    format: AGORA_PR2_MEMBERSHIP_FORMAT, protocolVersion: 1, networkId: "agoranode:test",
    membershipId: digest("membership:polisrossa:member-1"), actorId: "member:01", nodeId: "polisrossa",
    state: "active", admittedByDecisionDigest: digest("polisrossa-admission"), validFrom: 100, validUntil: null,
  };
  assert.equal(isPr3EligiblePr2(membership, 101, membership.networkId), true);
  assert.equal(isPr3EligiblePr2({...membership, nodeId: "another-node"}, 101, membership.networkId), true);
  assert.equal(isPr3EligiblePr2({...membership, state: "pending", admittedByDecisionDigest: null}, 101, membership.networkId), false);
  assert.equal(isPr3EligiblePr2({...membership, validUntil: 150}, 150, membership.networkId), false);
  assert.equal(isPr3EligiblePr2({...membership, networkId: "other-network"}, 101, membership.networkId), false);
});

test("PR3 follows nomination, consent, federal election, activation and recall as an append-only expiring mandate", async () => {
  const voters = electors("member", 7), election = await envelope("pr3-election", voters);
  const membership: Pr2MembershipProof = {
    format: AGORA_PR2_MEMBERSHIP_FORMAT, protocolVersion: 1, networkId: election.networkId,
    membershipId: digest("membership:polisrossa:member-1"), actorId: voters[0].id, nodeId: "polisrossa",
    state: "active", admittedByDecisionDigest: digest("polisrossa-admission"), validFrom: election.opensAt - 10_000, validUntil: null,
  };
  const base = {
    format: AGORA_PR3_MANDATE_RECORD_FORMAT, protocolVersion: 1 as const, networkId: election.networkId,
    mandateId: digest("pr3-mandate:member-1:term-1"), actorId: membership.actorId, federationId: "agoranode",
    sourceNodeId: membership.nodeId, sourceMembershipId: membership.membershipId, candidacySha256: election.proposalSha256,
  };
  const nomination: Pr3MandateRecord = {...base, state: "nominated", transitionAt: election.opensAt - 5_000, previousRecordDigest: null, electionDecisionDigest: null, startsAt: null, expiresAt: null, evidenceSha256: digest("nomination")};
  assert.equal((await validatePr3MandateTransition(null, nomination, {now: nomination.transitionAt, sourceMembership: membership})).state, "nominated");
  const candidacy: Pr3MandateRecord = {...nomination, state: "candidate", transitionAt: election.opensAt - 1_000, previousRecordDigest: await pr3MandateRecordDigest(nomination), evidenceSha256: election.proposalSha256};
  await assert.rejects(validatePr3MandateTransition(nomination, candidacy, {now: candidacy.transitionAt, sourceMembership: membership}), /candidate consent/);
  assert.equal((await validatePr3MandateTransition(nomination, candidacy, {now: candidacy.transitionAt, sourceMembership: membership, verifyActorConsent: () => true})).state, "candidate");
  const electionBallots = await Promise.all(voters.slice(0, 4).map(voter => ballot(election, voter, "members", "yes")));
  const electionCertificate = await evaluateGovernanceDecision(election, electionBallots, {now: election.closesAt, ...verifiers(voters)});
  assert.equal(electionCertificate.outcome, "approved");
  const startsAt = election.closesAt + 1;
  const elected: Pr3MandateRecord = {...candidacy, state: "elected", transitionAt: election.closesAt, previousRecordDigest: await pr3MandateRecordDigest(candidacy), electionDecisionDigest: electionCertificate.decisionDigest, startsAt, expiresAt: startsAt + 30 * 24 * 60 * 60 * 1000, evidenceSha256: electionCertificate.decisionDigest};
  assert.equal((await validatePr3MandateTransition(candidacy, elected, {now: elected.transitionAt, sourceMembership: membership, authorizationCertificate: electionCertificate})).state, "elected");
  const active: Pr3MandateRecord = {...elected, state: "active", transitionAt: startsAt, previousRecordDigest: await pr3MandateRecordDigest(elected), evidenceSha256: digest("accept-mandate")};
  await assert.rejects(
    validatePr3MandateTransition(elected, active, {
      now: startsAt,
      sourceMembership: {...membership, validUntil: startsAt},
      verifyActorConsent: () => true,
    }),
    /no longer an active PR2 member/,
  );
  assert.equal((await validatePr3MandateTransition(elected, active, {now: startsAt, sourceMembership: membership, verifyActorConsent: () => true})).state, "active");

  const recallBase = await envelope("pr3-recall", voters);
  const recall: GovernanceDecisionEnvelope = {...recallBase, sequence: 8, baseCheckpointId: digest("checkpoint:7"), proposalSha256: digest("recall:member-1:term-1"), opensAt: startsAt + 1_000, closesAt: startsAt + 3_601_000, appealClosesAt: startsAt + 86_401_000};
  const recallBallots = await Promise.all(voters.slice(0, 3).map(voter => ballot(recall, voter, "members", "yes")));
  const recallCertificate = await evaluateGovernanceDecision(recall, recallBallots, {now: recall.closesAt, ...verifiers(voters)});
  const recalled: Pr3MandateRecord = {...active, state: "recalled", transitionAt: recall.closesAt, previousRecordDigest: await pr3MandateRecordDigest(active), evidenceSha256: recall.proposalSha256};
  assert.equal((await validatePr3MandateTransition(active, recalled, {now: recalled.transitionAt, sourceMembership: membership, authorizationCertificate: recallCertificate})).state, "recalled");
  await assert.rejects(validatePr3MandateTransition(recalled, {...recalled, state: "active", transitionAt: recalled.transitionAt + 1, previousRecordDigest: await pr3MandateRecordDigest(recalled)}, {now: recalled.transitionAt + 1, sourceMembership: membership, verifyActorConsent: () => true}), /not allowed/);
});

test("PR3 rejects cross-network membership, forged election binding, oversized terms and hosting fields", async () => {
  const voters = electors("member", 7), election = await envelope("pr3-election", voters);
  const membership: Pr2MembershipProof = {format: AGORA_PR2_MEMBERSHIP_FORMAT, protocolVersion: 1, networkId: election.networkId, membershipId: digest("membership"), actorId: voters[0].id, nodeId: "polisrossa", state: "active", admittedByDecisionDigest: digest("admission"), validFrom: 0, validUntil: null};
  const nomination: Pr3MandateRecord = {format: AGORA_PR3_MANDATE_RECORD_FORMAT, protocolVersion: 1, networkId: election.networkId, mandateId: digest("mandate"), actorId: membership.actorId, federationId: "agoranode", sourceNodeId: membership.nodeId, sourceMembershipId: membership.membershipId, candidacySha256: election.proposalSha256, state: "nominated", transitionAt: election.opensAt - 2, previousRecordDigest: null, electionDecisionDigest: null, startsAt: null, expiresAt: null, evidenceSha256: digest("nomination")};
  await assert.rejects(validatePr3MandateTransition(null, nomination, {now: nomination.transitionAt, sourceMembership: {...membership, networkId: "another-network"}}), /does not match/);
  await assert.rejects(validatePr3MandateTransition(null, {...nomination, hostWeight: 99}, {now: nomination.transitionAt, sourceMembership: membership}), /unknown or missing fields/);
  const candidate: Pr3MandateRecord = {...nomination, state: "candidate", transitionAt: nomination.transitionAt + 1, previousRecordDigest: await pr3MandateRecordDigest(nomination), evidenceSha256: election.proposalSha256};
  const ballots = await Promise.all(voters.slice(0, 4).map(voter => ballot(election, voter, "members", "yes")));
  const certificate = await evaluateGovernanceDecision(election, ballots, {now: election.closesAt, ...verifiers(voters)});
  const tooLong: Pr3MandateRecord = {...candidate, state: "elected", transitionAt: election.closesAt, previousRecordDigest: await pr3MandateRecordDigest(candidate), electionDecisionDigest: certificate.decisionDigest, startsAt: election.closesAt, expiresAt: election.closesAt + AGORA_PR3_MAX_MANDATE_MS + 1, evidenceSha256: certificate.decisionDigest};
  await assert.rejects(validatePr3MandateTransition(candidate, tooLong, {now: tooLong.transitionAt, sourceMembership: membership, authorizationCertificate: certificate}), /mandate dates/);
  const forgedBinding: Pr3MandateRecord = {...tooLong, expiresAt: election.closesAt + 1000, candidacySha256: digest("substituted-candidacy")};
  await assert.rejects(validatePr3MandateTransition(candidate, forgedBinding, {now: forgedBinding.transitionAt, sourceMembership: membership, authorizationCertificate: certificate}), /identity changed|certificate/);
});
