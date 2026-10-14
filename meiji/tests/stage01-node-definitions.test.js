import test from "node:test";
import assert from "node:assert/strict";
import { NODE_DEFINITIONS, OPERATION_DEFINITIONS, TEXT_BUSINESSES } from "../shared/node-definitions.js";
import { nodeOf } from "../shared/task_contract.js";
import { emptyCharacterModel } from "../shared/models/character_model.js";
import { emptyCostumeModel } from "../shared/models/costume_model.js";
import { emptyCostumeImageModel } from "../shared/models/costume_image_model.js";
import { stepKinds, reviewTypes } from "../shared/task-plan.js";
import { projectFixture, taskFixture } from "./fixtures/project.js";

test("统一节点目录描述定位和审核规则", async () => {
  const project = projectFixture();
  const costume = emptyCostumeModel();
  const character = emptyCharacterModel({ costumes: [costume], costume_images: [emptyCostumeImageModel(costume.id)] });
  project.character_library.characters = [character];
  const targetByKind = {
    project: project.id,
    character: character.id,
    costume: character.costumes[0].id,
    episode: project.episodes[0].id,
    shot: project.episodes[0].shot_list.shots[0].id,
  };
  for (const [business, definition] of Object.entries(NODE_DEFINITIONS)) {
    const node = nodeOf(project, business, targetByKind[definition.targetKind]);
    const targetObject = {
      project,
      character,
      costume: character.costumes[0],
      episode: project.episodes[0],
      shot: project.episodes[0].shot_list.shots[0],
    }[definition.targetKind];
    assert.equal(node, ["costume-image", "character-image"].includes(business) ? character.costume_images[0] : targetObject[definition.field]);
    assert.equal(TEXT_BUSINESSES.includes(business), definition.handler === "text");
    assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), (definition.programReview || definition.aiReview));
  }
  for (const [business, definition] of Object.entries(OPERATION_DEFINITIONS)) {
    assert.equal(nodeOf(project, business, targetByKind[definition.targetKind]), null);
    assert.equal(stepKinds(taskFixture(project, business, targetByKind[definition.targetKind])).includes("review"), (definition.programReview || definition.aiReview));
  }
});

test("剧集摘要仅AI审核，大纲和镜头表依次程序及AI审核，共用两次修订", () => {
  for (const business of ["episode-summary", "outline", "shots"]) {
    assert.deepEqual(reviewTypes({ business_type: business }), business === "episode-summary" ? ["ai"] : ["program", "ai"]);
    assert.equal(NODE_DEFINITIONS[business].retryRounds, 2);
  }
});
