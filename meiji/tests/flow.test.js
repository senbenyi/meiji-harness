import test from 'node:test'
import assert from 'node:assert/strict'
import { episodeFixture } from './fixtures/model.js'
import { canGenerate, shotsReady, hasFilm } from '../shared/gates.js'
import { clearShotDownstream, sourcePatch } from '../shared/project-rules.js'
import { node, setContent } from '../shared/drama-model.js'
test('AI self-check alone unlocks downstream without manual approval',()=>{const p=episodeFixture();assert.equal(canGenerate(p,'shots'),true);assert.equal(shotsReady(p),true);assert.equal(p.shots.review.text,'');p.shots.check.passed=false;assert.equal(canGenerate(p,'storyboard'),false)})
test('upstream changes clear only the selected shot descendants',()=>{const p=episodeFixture();const patch=clearShotDownstream(p,'seconds','S01');assert.equal(patch.shots.items[0].storyboard.content,null);assert.deepEqual(patch.shots.items[1],p.shots.items[1]);assert.equal(patch.shots.items[0].seconds.content,p.shots.items[0].seconds.content)})
test('changing summary resets episode production, retaining new summary',()=>{const p=episodeFixture();const patch=sourcePatch(p,{summary:'新剧情'});assert.equal(patch.summary.content,'新剧情');assert.equal(patch.plot.outline.content,null);assert.equal(patch.shots.items.length,0)})
test('assembly requires every current shot video to pass',()=>{const p=episodeFixture();for(const s of p.shots.items)setContent(s.video,{status:'ready',url:'/video'},{passed:true,failures:[]});assert.equal(hasFilm(p),true);p.shots.items[1].video.status='failed';assert.equal(hasFilm(p),false)})
