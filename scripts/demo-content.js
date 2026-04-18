// Demo content definitions — edit this file to change what the demo site shows.
// Each entry is a tiddler with a sequence of versions (revisions).
// The seed script (seed-demo.js) replays these through the Revisor to build
// valid revision chains with proper hashes, deltas, and snapshots.
//
// Actions:
//   save     — create or update a tiddler (fields merged with previous state)
//   rename   — rename a tiddler (old name → new name, with optional field updates)
//   delete   — delete a tiddler (captures final state for Deleted Tiddlers sidebar)
//
// Each save/rename/delete advances the clock by `wait` minutes (default: 15).

module.exports = [

  // --- 1. Chocolate Chip Cookies ---
  // Main showcase: many edits, field changes, edit summaries, diff views
  {
    name: 'Chocolate Chip Cookies',
    versions: [
      {
        action: 'save',
        wait: 0,
        fields: {
          tags: 'Recipes',
          type: 'text/vnd.tiddlywiki',
          text: `! Chocolate Chip Cookies

A simple recipe for classic cookies.

!! Ingredients

* 1 cup butter
* 1 cup sugar
* 2 eggs
* 2 cups flour
* 1 cup chocolate chips

!! Instructions

Mix butter and sugar. Add eggs. Stir in flour. Fold in chips. Bake at 350°F for 12 minutes.`,
        },
      },
      {
        action: 'save',
        wait: 30,
        summary: 'Clarified butter should be softened',
        fields: {
          text: `! Chocolate Chip Cookies

A simple recipe for classic chocolate chip cookies.

!! Ingredients

* 1 cup butter, softened
* 1 cup sugar
* 2 eggs
* 2 cups flour
* 1 cup chocolate chips

!! Instructions

Mix butter and sugar. Add eggs. Stir in flour. Fold in chips. Bake at 350°F for 12 minutes.`,
        },
      },
      {
        action: 'save',
        wait: 15,
        summary: 'Split sugar into white+brown, added vanilla',
        fields: {
          text: `! Chocolate Chip Cookies

A simple recipe for classic chocolate chip cookies.

!! Ingredients

* 1 cup butter, softened
* 3/4 cup white sugar
* 1/4 cup brown sugar
* 2 eggs
* 1 tsp vanilla extract
* 2 cups flour
* 1 cup chocolate chips

!! Instructions

Mix butter and sugar. Add eggs. Stir in flour. Fold in chips. Bake at 350°F for 12 minutes.`,
        },
      },
      {
        action: 'save',
        wait: 45,
        summary: 'Complete rewrite with proper measurements and numbered steps',
        fields: {
          tags: 'Recipes Baking',
          text: `! Chocolate Chip Cookies

A simple recipe for classic chocolate chip cookies.

!! Ingredients

* 1 cup butter, softened
* 3/4 cup white sugar
* 1/4 cup brown sugar
* 2 eggs
* 1 tsp vanilla extract
* 2 1/4 cups all-purpose flour
* 1 tsp baking soda
* 1/2 tsp salt
* 2 cups chocolate chips

!! Instructions

# Cream butter and sugars until fluffy.
# Beat in eggs one at a time, then add vanilla.
# Whisk flour, baking soda, and salt in a separate bowl.
# Gradually mix dry ingredients into wet.
# Fold in chocolate chips.
# Drop rounded tablespoons onto baking sheet.
# Bake at 375°F for 9–11 minutes until golden.
# Cool on pan for 5 minutes before transferring.`,
        },
      },
      {
        action: 'save',
        wait: 20,
        summary: 'Added difficulty field and Favorites tag',
        fields: {
          tags: 'Recipes Baking Favorites',
          difficulty: 'easy',
        },
      },
      {
        action: 'save',
        wait: 60,
        summary: 'Added yield, prep/cook times, tips section, and more precise instructions',
        fields: {
          yield: '48 cookies',
          'prep-time': '15 minutes',
          'cook-time': '10 minutes',
          text: `! Chocolate Chip Cookies

A simple recipe for classic chocolate chip cookies. Makes about 48 cookies.

!! Ingredients

* 1 cup (2 sticks) butter, softened
* 3/4 cup white sugar
* 1/4 cup packed brown sugar
* 2 large eggs
* 1 tsp vanilla extract
* 2 1/4 cups all-purpose flour
* 1 tsp baking soda
* 1/2 tsp salt
* 2 cups semi-sweet chocolate chips

!! Instructions

# Preheat oven to 375°F (190°C).
# Cream butter and sugars until fluffy, about 3 minutes.
# Beat in eggs one at a time, then add vanilla.
# Whisk flour, baking soda, and salt in a separate bowl.
# Gradually mix dry ingredients into wet on low speed.
# Fold in chocolate chips.
# Drop rounded tablespoons onto ungreased baking sheet, spacing 2 inches apart.
# Bake for 9–11 minutes until edges are golden but centers look slightly underdone.
# Cool on pan for 5 minutes before transferring to wire rack.

!! Tips

* For chewier cookies, use more brown sugar and less white.
* Chill dough for 30 minutes for thicker cookies.
* Don't overbake — they firm up as they cool.`,
        },
      },
      {
        action: 'save',
        wait: 120,
        summary: 'Added variations section',
        fields: {
          text: `! Chocolate Chip Cookies

A simple recipe for classic chocolate chip cookies. Makes about 48 cookies.

!! Ingredients

* 1 cup (2 sticks) butter, softened
* 3/4 cup white sugar
* 1/4 cup packed brown sugar
* 2 large eggs
* 1 tsp vanilla extract
* 2 1/4 cups all-purpose flour
* 1 tsp baking soda
* 1/2 tsp salt
* 2 cups semi-sweet chocolate chips

!! Instructions

# Preheat oven to 375°F (190°C).
# Cream butter and sugars until fluffy, about 3 minutes.
# Beat in eggs one at a time, then add vanilla.
# Whisk flour, baking soda, and salt in a separate bowl.
# Gradually mix dry ingredients into wet on low speed.
# Fold in chocolate chips.
# Drop rounded tablespoons onto ungreased baking sheet, spacing 2 inches apart.
# Bake for 9–11 minutes until edges are golden but centers look slightly underdone.
# Cool on pan for 5 minutes before transferring to wire rack.

!! Tips

* For chewier cookies, use more brown sugar and less white.
* Chill dough for 30 minutes for thicker cookies.
* Don't overbake — they firm up as they cool.

!! Variations

* ''Double Chocolate:'' Replace 1/4 cup flour with cocoa powder.
* ''Oatmeal Chip:'' Replace 1 cup flour with 1 cup rolled oats.
* ''Nutty:'' Add 1 cup chopped walnuts or pecans.`,
        },
      },
    ],
  },

  // --- 2. Pie Crust → Grandma's Pie Crust ---
  // Demonstrates rename tracking
  {
    name: 'Pie Crust',
    versions: [
      {
        action: 'save',
        wait: 30,
        fields: {
          tags: 'Recipes Baking',
          type: 'text/vnd.tiddlywiki',
          text: `! Pie Crust

A basic flaky pie crust.

!! Ingredients

* 2 1/2 cups flour
* 1 tsp salt
* 1 cup cold butter, cubed
* 1/4 to 1/2 cup ice water

!! Instructions

# Cut butter into flour and salt until pea-sized.
# Add ice water 1 tbsp at a time until dough holds together.
# Form into disc, wrap, and chill for 1 hour.
# Roll out on floured surface.`,
        },
      },
      {
        action: 'save',
        wait: 60,
        summary: 'Added sugar, tips, and more detailed instructions',
        fields: {
          text: `! Pie Crust

A basic flaky pie crust. Makes enough for a 9-inch double-crust pie.

!! Ingredients

* 2 1/2 cups all-purpose flour
* 1 tsp salt
* 1 tsp sugar
* 1 cup (2 sticks) cold unsalted butter, cubed
* 1/4 to 1/2 cup ice water

!! Instructions

# Cut butter into flour, salt, and sugar until pea-sized crumbles form.
# Add ice water 1 tbsp at a time, mixing gently until dough just holds together.
# Divide in half, form each into a disc, wrap in plastic.
# Chill for at least 1 hour (or overnight).
# Roll out on lightly floured surface to 1/8 inch thickness.

!! Tips

* Keep everything cold — cold butter = flaky crust.
* Don't overwork the dough or it'll be tough.`,
        },
      },
      {
        action: 'save',
        wait: 45,
        summary: "Added grandma's secret: shortening and apple cider vinegar",
        fields: {
          tags: 'Recipes Baking Favorites',
          text: `! Pie Crust

A basic flaky pie crust, perfected over decades. Makes enough for a 9-inch double-crust pie.

!! Ingredients

* 2 1/2 cups all-purpose flour
* 1 tsp salt
* 1 tsp sugar
* 1 cup (2 sticks) cold unsalted butter, cubed
* 2 tbsp cold shortening
* 1/4 to 1/2 cup ice water
* 1 tbsp apple cider vinegar

!! Instructions

# Cut butter and shortening into flour, salt, and sugar until pea-sized crumbles form.
# Mix vinegar into ice water.
# Add liquid 1 tbsp at a time, mixing gently until dough just holds together.
# Divide in half, form each into a disc, wrap in plastic.
# Chill for at least 1 hour (or overnight).
# Roll out on lightly floured surface to 1/8 inch thickness.

!! Tips

* Keep everything cold — cold butter = flaky crust.
* Don't overwork the dough or it'll be tough.
* The vinegar helps tenderness without adding flavor.
* This is the recipe grandma used for 40 years.`,
        },
      },
      {
        action: 'rename',
        wait: 30,
        newName: "Grandma's Pie Crust",
        fields: {
          text: `! Grandma's Pie Crust

A basic flaky pie crust, perfected over decades. Makes enough for a 9-inch double-crust pie.

!! Ingredients

* 2 1/2 cups all-purpose flour
* 1 tsp salt
* 1 tsp sugar
* 1 cup (2 sticks) cold unsalted butter, cubed
* 2 tbsp cold shortening
* 1/4 to 1/2 cup ice water
* 1 tbsp apple cider vinegar

!! Instructions

# Cut butter and shortening into flour, salt, and sugar until pea-sized crumbles form.
# Mix vinegar into ice water.
# Add liquid 1 tbsp at a time, mixing gently until dough just holds together.
# Divide in half, form each into a disc, wrap in plastic.
# Chill for at least 1 hour (or overnight).
# Roll out on lightly floured surface to 1/8 inch thickness.

!! Tips

* Keep everything cold — cold butter = flaky crust.
* Don't overwork the dough or it'll be tough.
* The vinegar helps tenderness without adding flavor.
* This is the recipe grandma used for 40 years.`,
        },
      },
    ],
  },

  // --- 3. Sourdough Starter ---
  // Will be deleted — demonstrates delete capture + restore from sidebar
  {
    name: 'Sourdough Starter',
    versions: [
      {
        action: 'save',
        wait: 15,
        fields: {
          tags: 'Recipes Baking',
          type: 'text/vnd.tiddlywiki',
          text: `! Sourdough Starter

How to create and maintain a sourdough starter from scratch.

!! Day 1

Mix 1/2 cup flour and 1/4 cup water. Cover loosely. Wait 24 hours.

!! Day 2–7

Discard half, feed with 1/2 cup flour and 1/4 cup water daily.

!! Maintenance

Once active (doubles in 4–6 hours), feed daily on counter or weekly in fridge.`,
        },
      },
      {
        action: 'save',
        wait: 60,
        summary: 'Expanded with day-by-day instructions and troubleshooting',
        fields: {
          tags: 'Recipes Baking Fermentation',
          text: `! Sourdough Starter

How to create and maintain a sourdough starter from scratch.

!! Day 1

Mix 1/2 cup whole wheat flour and 1/4 cup lukewarm water (about 80°F). Stir until smooth paste forms. Cover loosely with cloth or plastic wrap. Wait 24 hours.

!! Day 2

Look for small bubbles — this is good! Discard half the starter. Feed with 1/2 cup all-purpose flour and 1/4 cup water. Mix well, cover, wait 24 hours.

!! Days 3–7

Repeat: discard half, feed with 1/2 cup flour and 1/4 cup water. By day 5, it should be doubling in size between feedings. By day 7, it should have a pleasant sour smell and reliably double within 4–6 hours.

!! Maintenance

* ''Counter:'' Feed daily. Best for frequent bakers.
* ''Fridge:'' Feed weekly. Pull out night before baking, feed, let rise overnight.
* ''Signs of health:'' Doubles in size, pleasant tangy smell, lots of bubbles.
* ''Signs of trouble:'' Pink or orange streaks (discard and start over), strong chemical smell (feed more frequently).`,
        },
      },
      {
        action: 'save',
        wait: 30,
        summary: 'Added float test and discard recipe ideas',
        fields: {
          'starter-name': 'Bubbles',
          text: `! Sourdough Starter

How to create and maintain a sourdough starter from scratch.

!! Day 1

Mix 1/2 cup whole wheat flour and 1/4 cup lukewarm water (about 80°F). Stir until smooth paste forms. Cover loosely with cloth or plastic wrap. Wait 24 hours.

!! Day 2

Look for small bubbles — this is good! Discard half the starter. Feed with 1/2 cup all-purpose flour and 1/4 cup water. Mix well, cover, wait 24 hours.

!! Days 3–7

Repeat: discard half, feed with 1/2 cup flour and 1/4 cup water. By day 5, it should be doubling in size between feedings. By day 7, it should have a pleasant sour smell and reliably double within 4–6 hours.

!! The Float Test

Drop a teaspoon of starter into water. If it floats, it's ready to bake with!

!! Maintenance

* ''Counter:'' Feed daily. Best for frequent bakers.
* ''Fridge:'' Feed weekly. Pull out night before baking, feed, let rise overnight.
* ''Signs of health:'' Doubles in size, pleasant tangy smell, lots of bubbles.
* ''Signs of trouble:'' Pink or orange streaks (discard and start over), strong chemical smell (feed more frequently).

!! Discard Recipes

Don't throw away that discard! Use it for:
* Pancakes and waffles
* Crackers
* Pizza dough
* Banana bread`,
        },
      },
      {
        action: 'delete',
        wait: 15,
      },
    ],
  },

  // --- 4. Kitchen Notes ---
  // Many small edits to demonstrate pagination (>20 revisions)
  {
    name: 'Kitchen Notes',
    versions: [
      { action: 'save', wait: 15, summary: 'Started grocery list', fields: { tags: 'Journal', type: 'text/vnd.tiddlywiki', text: 'Grocery list:\n* Eggs\n* Milk\n* Butter' } },
      { action: 'save', wait: 15, summary: 'Need flour', fields: { text: 'Grocery list:\n* Eggs\n* Milk\n* Butter\n* Flour' } },
      { action: 'save', wait: 15, summary: 'And sugar', fields: { text: 'Grocery list:\n* Eggs\n* Milk\n* Butter\n* Flour\n* Sugar' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list:\n* Eggs\n* Milk\n* Butter\n* Flour\n* Sugar\n* Vanilla extract' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list:\n* Eggs\n* Milk\n* Butter\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips' } },
      { action: 'save', wait: 15, summary: 'Almost forgot leavening', fields: { text: 'Grocery list:\n* Eggs\n* Milk\n* Butter\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda' } },
      { action: 'save', wait: 15, summary: 'Updated quantities', fields: { text: 'Grocery list:\n* Eggs (2 dozen)\n* Milk\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda' } },
      { action: 'save', wait: 15, summary: 'Added meal plan', fields: { text: 'Grocery list:\n* Eggs (2 dozen)\n* Milk\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta' } },
      { action: 'save', wait: 15, summary: 'Wednesday soup', fields: { text: 'Grocery list:\n* Eggs (2 dozen)\n* Milk\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta\n* Wednesday: soup' } },
      { action: 'save', wait: 15, summary: 'Thursday stir fry', fields: { text: 'Grocery list:\n* Eggs (2 dozen)\n* Milk\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry' } },
      { action: 'save', wait: 15, summary: 'Got eggs', fields: { text: 'Grocery list:\n* ~~Eggs (2 dozen)~~ got them\n* Milk\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list:\n* ~~Eggs (2 dozen)~~ got them\n* ~~Milk~~ got it\n* Butter (2 sticks)\n* Flour\n* Sugar\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry\n* Friday: pizza night!' } },
      { action: 'save', wait: 15, summary: 'Big shopping trip — got most staples', fields: { text: 'Grocery list:\n* ~~Eggs (2 dozen)~~ got them\n* ~~Milk~~ got it\n* ~~Butter (2 sticks)~~ got it\n* ~~Flour~~ got it\n* ~~Sugar~~ got it\n* Vanilla extract\n* Chocolate chips\n* Baking soda\n\nMeal plan:\n* Monday: cookies\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry\n* Friday: pizza night!' } },
      { action: 'save', wait: 15, summary: 'All groceries acquired! Baking day!', fields: { text: 'Grocery list:\n* ~~Eggs (2 dozen)~~ ✓\n* ~~Milk~~ ✓\n* ~~Butter (2 sticks)~~ ✓\n* ~~Flour~~ ✓\n* ~~Sugar~~ ✓\n* ~~Vanilla extract~~ ✓\n* ~~Chocolate chips~~ ✓\n* ~~Baking soda~~ ✓\n\nAll done! Time to bake.\n\nMeal plan:\n* Monday: cookies ← today!\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry\n* Friday: pizza night!' } },
      { action: 'save', wait: 15, summary: 'Monday cookies done, linked recipe', fields: { text: 'Grocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* Tuesday: pasta\n* Wednesday: soup\n* Thursday: stir fry\n* Friday: pizza night!\n\nNotes:\n* Cookie recipe is in [[Chocolate Chip Cookies]]' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* Wednesday: soup\n* Thursday: stir fry\n* Friday: pizza night!\n\nNotes:\n* Cookie recipe is in [[Chocolate Chip Cookies]]' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* Thursday: stir fry\n* Friday: pizza night!\n\nNotes:\n* Cookie recipe is in [[Chocolate Chip Cookies]]\n* Need to find a good soup recipe to save' } },
      { action: 'save', wait: 15, fields: { text: 'Grocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* ~~Thursday: stir fry~~ — used frozen veggies\n* Friday: pizza night!\n\nNotes:\n* Cookie recipe is in [[Chocolate Chip Cookies]]\n* Need to find a good soup recipe to save\n* Stir fry tip: heat wok BEFORE adding oil' } },
      { action: 'save', wait: 15, summary: 'Week complete! Sourdough pizza was the highlight', fields: { text: 'Grocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* ~~Thursday: stir fry~~ — used frozen veggies\n* ~~Friday: pizza night!~~ — used sourdough discard for dough\n\nNotes:\n* Cookie recipe is in [[Chocolate Chip Cookies]]\n* Need to find a good soup recipe to save\n* Stir fry tip: heat wok BEFORE adding oil\n* Sourdough pizza dough is amazing — see [[Sourdough Starter]]' } },
      { action: 'save', wait: 15, summary: 'End of week wrap-up with lessons learned heading', fields: { text: '! Kitchen Notes\n\nWeek of March 1 — complete!\n\nGrocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* ~~Thursday: stir fry~~ — used frozen veggies\n* ~~Friday: pizza night!~~ — used sourdough discard for dough\n\n!! Lessons learned\n* Cookie recipe is in [[Chocolate Chip Cookies]] — keeper\n* Need to find a good soup recipe to save\n* Stir fry tip: heat wok BEFORE adding oil\n* Sourdough pizza dough is amazing — see [[Sourdough Starter]]\n* Brown sugar makes chewier cookies (noted in cookie recipe tips)' } },
      { action: 'save', wait: 15, summary: 'Planning next week', fields: { text: '! Kitchen Notes\n\nWeek of March 1 — complete!\n\nGrocery list: DONE ✓\n\nMeal plan:\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* ~~Thursday: stir fry~~ — used frozen veggies\n* ~~Friday: pizza night!~~ — used sourdough discard for dough\n\n!! Lessons learned\n* Cookie recipe is in [[Chocolate Chip Cookies]] — keeper\n* Need to find a good soup recipe to save\n* Stir fry tip: heat wok BEFORE adding oil\n* Sourdough pizza dough is amazing — see [[Sourdough Starter]]\n* Brown sugar makes chewier cookies (noted in cookie recipe tips)\n\n!! Next week\n* Try [[Grandma\'s Pie Crust]] for pot pie\n* Experiment with double chocolate cookie variation' } },
      { action: 'save', wait: 15, summary: 'Cleaned up formatting, noticed sourdough notes gone', fields: { text: '! Kitchen Notes\n\nWeek of March 1 — complete!\n\n!! Meal plan (done)\n* ~~Monday: cookies~~ — came out great!\n* ~~Tuesday: pasta~~ — used leftover sauce\n* ~~Wednesday: soup~~ — chicken noodle\n* ~~Thursday: stir fry~~ — used frozen veggies\n* ~~Friday: pizza night!~~ — used sourdough discard for dough\n\n!! Lessons learned\n* Cookie recipe is in [[Chocolate Chip Cookies]] — keeper\n* Stir fry tip: heat wok BEFORE adding oil\n* Sourdough pizza dough is amazing\n* Brown sugar makes chewier cookies\n\n!! Next week\n* Try [[Grandma\'s Pie Crust]] for pot pie\n* Experiment with double chocolate cookie variation\n* Start new [[Sourdough Starter]] (deleted old notes by accident!)' } },
    ],
  },

  // --- 5. Welcome to Timelord ---
  // Landing page with guided tour
  {
    name: 'Welcome to Timelord',
    versions: [
      {
        action: 'save',
        wait: 30,
        fields: {
          tags: '',
          type: 'text/vnd.tiddlywiki',
          text: `! Welcome to Timelord

''Timelord'' is a TiddlyWiki plugin that automatically captures a revision every time you save a tiddler — text changes, tag edits, custom fields, everything.

This demo wiki has pre-built revision histories you can explore:

!! Try these

* ''[[Chocolate Chip Cookies]]'' — Open the info panel (''ⓘ'' button) and click the ''Revisions'' tab. You'll see 7 revisions with text diffs, field changes, and edit summaries.
* ''[[Grandma's Pie Crust]]'' — Was originally called "Pie Crust" — the revision history shows the rename event.
* ''[[Kitchen Notes]]'' — Has 22 revisions to demonstrate pagination. Toggle "Oldest first" to reverse the sort.
* ''Deleted Tiddlers'' sidebar tab — "Sourdough Starter" was deleted. You can restore it from there.

!! What to look for

* ''Diff views'' — Click "Diff vs. current" or "Diff vs. previous" on any revision.
* ''Field changes'' — Revisions that changed tags or custom fields show a "Fields:" summary. Click to expand before→after values.
* ''Edit summaries'' — Many revisions have a note explaining //why// the change was made.
* ''Restore'' — Click "Restore this version" on any revision. The current state is captured first, so restore is undoable.
* ''Settings'' — Open the Control Panel → Timelord to see the pause toggle, exclusion filter, and chain verify/repair tools.
* ''Stats'' — Check More → Timelord in the sidebar for aggregate revision statistics.

!! Install it

Drag the plugin link from [[Installation]] into your own wiki. That's it.

!! Edit something!

Create a new tiddler or edit any of the recipes. Your changes will be tracked automatically — check the Revisions tab to see them appear.`,
        },
      },
    ],
  },

  // --- 6. Installation ---
  // Static page, no revisions — just the drag-to-install link
  {
    name: 'Installation',
    versions: [
      {
        action: 'save',
        wait: 0,
        fields: {
          tags: '',
          type: 'text/vnd.tiddlywiki',
          text: `!! Installing the Plugin

To install the ''Timelord'' plugin into your own TiddlyWiki:

# Drag the link below and drop it onto your TiddlyWiki page:

<div style="margin: 1em 2em; padding: 1em; background: <<colour tiddler-background>>; border: 1px solid <<colour tiddler-editor-border>>; border-radius: 4px; text-align: center;">
<$link to="$:/plugins/mblackman/timelord" style="font-size: 1.2em; font-weight: bold;">⬇ timelord</$link>
</div>

# TiddlyWiki will ask you to confirm the import — click ''Import''.
# Save your wiki. The plugin will be active immediately.

!! Requirements

* TiddlyWiki \`>=5.3.0\`

!! Notes

* The link above points to the installed version of the plugin on this demo site.
* You can also download the single-file plugin directly from the [[GitHub releases page|https://github.com/mblackman/tiddlywiki-timelord/releases]].`,
        },
      },
    ],
  },
];
