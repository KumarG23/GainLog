import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const nutritionScreen = readFileSync(
  new URL('../app/(tabs)/nutrition.tsx', import.meta.url),
  'utf8',
);

test('Nutrition presents goal-aware daily progress from active goals', () => {
  assert.match(nutritionScreen, /selectNutritionGoals\(goals\)/);
  assert.match(nutritionScreen, /formatNutritionProgress/);
  assert.match(nutritionScreen, /Today · in progress/);
});

test('Nutrition averages seven completed days instead of treating today as complete', () => {
  assert.match(nutritionScreen, /const completedHistoryEnd = previousLocalDateKey/);
  assert.match(nutritionScreen, /\[nutritionEntries, completedHistoryEnd\]/);
  assert.match(nutritionScreen, /averageMacroDays\(completedMacroHistory\)/);
  assert.match(nutritionScreen, /macroAverages\.loggedDays/);
  assert.match(nutritionScreen, /macroAverages\.loggedDays === 1 \? 'day' : 'days'/);
});

test('Nutrition keeps quick actions compact and expands them on demand', () => {
  assert.match(nutritionScreen, /showAllQuickAdds/);
  assert.match(nutritionScreen, /quickAdds\.slice\(0, 3\)/);
  assert.match(nutritionScreen, /Show all/);
});

test('Nutrition manual entry is disclosed on demand and macro inputs use a wrapping grid', () => {
  assert.match(nutritionScreen, /showManualForm/);
  assert.match(nutritionScreen, /macroInputGrid/);
  assert.match(nutritionScreen, /minWidth: '47%'/);
  assert.doesNotMatch(nutritionScreen, /<View style=\{styles\.row\}>/);
});

test('Nutrition history renders a calorie target marker when a goal exists', () => {
  assert.match(nutritionScreen, /historyTargetMarker/);
  assert.match(nutritionScreen, /targetPercent/);
  assert.match(nutritionScreen, /nutritionGoalReferenceValue\(nutritionGoals\.calories\)/);
});
