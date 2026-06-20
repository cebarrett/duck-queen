/**
 * What the old swan, Aldermere, has to say. This is just the *writing* — the
 * Swan's little dialogue state machine (in Swan.ts) steps the Queen through it,
 * and the HUD draws it. Keeping the prose here makes it easy to find and reword.
 *
 * Aldermere is neither duck nor goose: an ancient, impartial witness who has
 * watched the Duck Queendom rise and dwindle to this one pond. He is serene,
 * a touch vain (those raised wings), fond of the ducks and their impossible task,
 * and weary of the geese — but he keeps no kingdom himself. He only keeps count.
 *
 * Each phase is a list of DISCOURSES, and each discourse is a list of pages (the
 * lines the player clicks through). A fresh conversation delivers the next
 * discourse in the list, looping — so a player who keeps coming back hears the
 * swan muse on different things instead of repeating one block.
 */

/** A conversation is an ordered list of pages the player advances through. */
export type Discourse = readonly string[]

/** The name shown on the dialogue box. */
export const SWAN_NAME = '🦢 Aldermere, the Old Swan'

/**
 * Before the Marsh Baron falls: the swan introduces himself, remembers the
 * Queendom's long decline, and offers an old bird's counsel to a young crown.
 */
export const BEFORE_BARON: readonly Discourse[] = [
  // The first, fullest talk — who he is, the past, and the first advice.
  [
    'Ah. A crown on so small a head. Come closer, little sovereign — I shall not honk at you, and I am far too old to bow.',
    'I am Aldermere. I was gliding this water before your great-great-grandmother wore twisted reeds for gold, and I shall glide it still after the last banner sinks. Swans keep no kingdom. We only keep count.',
    'And I have counted much. I watched the ducks rise — what a thing it was! — and I watched them dwindle to this single bright pond, and to you. Seven queens, the old nests say. Some say six. The difference is a wound nobody will let me see.',
    'Your foremothers were not fools, Majesty. Each was right about something — and each was undone by the very thing she was right about. That is the cruelty of crowns: a good answer, held too long, hardens into the next queen’s burden.',
    'The first of them gathered a flock from frightened strangers. A duck alone is lunch, she said; a flock is weather. She was right, and so the Queendom learned it cannot so much as breathe unless someone calls it together. Remember her first.',
    'But weather wants tending. One queen built ledgers of mounds and caches; one welcomed every wing that would answer; one drew borders and trusted the geese to honor them. Watch the geese on that last point. They never break a border. They lean on it.',
    'So here is an old bird’s counsel, for what counsel is worth on open water: rally before you fight, feed before you boast, and never love a banner more than the ducklings it is raised to shelter. Symbols are light to carry and impossible to eat.',
    'Now — there is a goose out past the reeds who fancies himself a Baron. He has a trick: he honks your flock apart, the soft voices first, until your chorus is one thin note he can simply shout down. Do not face him thin. Bring drakes, and many — the deep voices hold when the rest go scattering.',
    'Off you go, then. Your ducklings are eating something they oughtn’t, as ducklings eternally are. A queen’s work is never finished — only, if she is wise, made lighter for whoever comes after. Waddle on.',
  ],
  // A shorter musing, on the nature of the geese.
  [
    'Back again? Good. The water is more interesting with a crown afloat on it.',
    'You wish to understand the geese. Few ducks ever bother — which is, rather, the whole trouble. A duck forgets an insult by sundown. A goose carves it into the next three generations and teaches the goslings to recite it.',
    'They are not evil, child. They are something a story finds harder to forgive: they are coherent. They remember. They organize. They hold. To a goose, any ground he can stand upon was always meant for geese — and he believes it with a clear and tranquil heart.',
    'So do not wait for them to hate you. They will merely press, and press, and name it the natural order, until a pond that was yours is only a pond they happen to be standing in. Answer their pressure with your presence. Be there; be many; be loud — and be there again tomorrow.',
  ],
  // A shorter musing, on the missing queen and the crown itself.
  [
    'You count yourself the seventh, I think. The nests that taught you to count left a line out on purpose.',
    'There was a queen between the thunder and you. A quiet one. A listener. She believed the Queendom failed not from any weakness but from leaning forever on one perfect duck — and she set herself to teach the ponds to hold themselves upright.',
    'She walked into the marsh one low-misted morning and did not glide back out. They scratched her name from the gold to spare the flock the grief of her. The geese, naturally, remember it. They honk it when the fog lies thick, to frighten their young.',
    'I tell you this not to dishearten you, Majesty, but to spare you her one mistake — her secrecy. A Queendom that hangs on a single voice can be out-waited. Build one that can sing without you. It is the only crown the geese have never once learned how to steal.',
  ],
]

/**
 * After the Marsh Baron is broken: the swan acknowledges her boldness, warns
 * that history has done this before, and cautions her about everything that
 * comes *after* a victory.
 */
export const AFTER_BARON: readonly Discourse[] = [
  // The fullest after-talk — praise, the warning from history, the road ahead.
  [
    'So. The marsh has gone quiet where the Baron used to bluster. I felt the water change — even out here, even in these old feathers. You broke his splitting honk and kept your chorus whole. Bold, Majesty. Genuinely, gladly bold.',
    'Now let me tell you a thing the songs leave out. You are not the first crown to break that Baron. The thunder-queen, Stormbill, snapped his voice a long lifetime ago. The songs say she broke the Marsh Baron. The nests say she came back alone.',
    'She won every fight she could reach, and lost the kingdom in the gaps between them — recovering ponds faster than her ducks could settle into them, driving off geese faster than trust could grow back. Her courage outran her. I would rather not watch that happen a second time.',
    'So hear me while the victory is still warm and teachable. A broken baron is not a healed marsh. You have won a voice, not a war. The geese do not mourn him — they merely note him, and adjust. There are colder ones behind him who never raise their voices at all.',
    'One will offer you a border and a handshake, and punish you for the taking of it. One will topple your banners in the dark until your own ducklings flinch at the sight of safety. One will refuse your grand chorus entirely, and pick instead at your weakest, your furthest, your sleepiest edge.',
    'And at the very back of the marsh waits the oldest fear of all — a general who is not afraid of your honk in the least. He is afraid of the morning your ducks stay a Queendom while you are nowhere near them. Become that, and you become the one thing the geese have never managed to out-wait.',
    'So do not go spending this triumph to buy yourself more triumphs. Go back, and feed what you have taken. Let the marsh be dull and safe and fat awhile. Glory is a current, little queen — thrilling, and it carries you out past your depth before ever you notice the shore has gone.',
    'There. An old swan has cautioned a young queen, as is only proper, and now I shall pretend not to be proud of her. Go on. The hardest part was never the Baron. It is all the quiet that comes after a win — when no one is honking, and the real work waits.',
  ],
  // A shorter follow-up — yours versus safe.
  [
    'Still flush with it, I see. Enjoy that; it fades, and you ought to taste it while it is bright.',
    'But mind the difference between the marsh being yours and the marsh being safe. Yours is a moment. Safe is a practice — caches stocked, routes remembered, ducklings who can find the warm bank whether or not the Queen is watching them do it.',
    'The geese will spend these coming seasons teaching their goslings precisely why this marsh shall one day be theirs again. Spend yours teaching ducks to mind one another while you are elsewhere. Whichever flock learns its lesson the better will hold the water. It is that simple, and that hard.',
  ],
  // A shorter, more tender close.
  [
    'Sit a moment. The water is calm; it rather suits a conversation.',
    'I have watched seven crowns now — or six, depending on which grief you trust. And I have learned to tell early which queens will be remembered fondly. It is never the ones who won the most. It is the ones who left the flock stronger than they found it — win or lose.',
    'You will not restore the old Queendom, Majesty. That one failed; let it rest. Build instead the sillier, humbler, better-fed thing it never managed to become — one that does not need a flawless queen to keep from scattering. Do that, and even an old swan who keeps no kingdom will be glad to have shared his pond with you.',
  ],
]

/**
 * After the Treaty Flats hold: Aldermere acknowledges the victory over Lord Boundary
 * and sends the Queen to the outlying ponds — the far edge each king ignores until it
 * is lost. This phase lasts until the frontier is fully reclaimed.
 */
export const AFTER_TREATY: readonly Discourse[] = [
  // Quest-giving: the frontier assignment.
  [
    'The Treaty Flats hold. Lord Boundary is gone from the water, and the line he kept is yours to walk now. I confess I am relieved — he was a patient goose, and patience outlasts almost everything. But it seems you were more stubborn than he was precise.',
    'Now look to the far ponds. I warned you of them when the Baron fell — the ones at the sleepiest edges, the furthest corners, each quietly occupied by a lieutenant who has spent the season making himself local and difficult.',
    'They will not challenge you grandly. They will simply be there, holding a pond that should be yours, waiting for you to decide the far edge is not worth the journey. Do not agree with them. Go to each one. Bring your voice. Bring your ducks. Drown their patience in numbers, and make those ponds ordinary and blue and ours.',
    'The frontier is the last frontier. Off you go, Majesty. I would not say so if I did not think you could hold it.',
  ],
  // A shorter musing for repeat visits while the frontier campaign is ongoing.
  [
    'Still at it? Good. The far ponds are stubborn things — but then, so are you, which rather tips the balance.',
    'A lieutenant gander is not a great strategist. He is merely present. The answer to a patient local is a more patient one — and one who happens to have a great deal more ducks. Return when he expects silence; hold when he expects you to tire. Out-local the local. It is the oldest conquest on the water, and it still works every time.',
  ],
]

/**
 * After every outlying pond is reclaimed: the swan marks the frontier won — the
 * "furthest, sleepiest edge" he warned of is quiet — and turns the Queen's eye to
 * the last, unspoken fear: not a louder honk, but a Queendom that holds itself
 * together when she is nowhere near it.
 */
export const AFTER_FRONTIER: readonly Discourse[] = [
  // The fullest talk — the edge is held; now the real test.
  [
    'So you went and did it. The far ponds — the furthest, sleepiest edges, the ones a kingdom always loses first because no one is ever quite looking at them — all of them blue again. I felt each one clear from here, like a held breath let go.',
    'I confess I did not expect it of you. The edge-picker is the cleverest of the geese, you know. He never challenges your grand chorus; he simply waits for the pond you have forgotten, the duckling who wandered too far, the evening you were tired. He picks. And you, it seems, refused to forget.',
    'But mark what reclaiming truly cost you, Majesty — not a honk, but a presence. You had to be everywhere. And no queen can be everywhere forever; that was the whole lesson of the marsh, and of poor Stormbill, and of the quiet listening one whose name they scratched from the gold.',
    'Which leaves the oldest fear of all, the one at the very back of the marsh. There waits a general who is not frightened of your voice in the slightest. He has heard a hundred queens out-honk a hundred ganders. What he fears — the only thing he fears — is the morning your ducks wake a Queendom while you are off on the far water, and simply carry on without you.',
    'So do not come to me asking where he is. Ask instead whether your flock would hold these ponds tomorrow if you vanished into the fog this very night. The day the answer is yes, you will not need to find him. He will already have lost.',
  ],
  // A shorter musing — on holding versus winning.
  [
    'The whole frontier, blue. Enjoy it; you earned the looking.',
    'Here is the thing the geese understand that ducks forever forget: holding is not a battle you win, it is a habit you keep. They did not lose those ponds because your honk was louder. They lost them because your ducks stayed — foraged them, nested them, made them ordinary and dull and lived-in.',
    'Dull is the strongest fortification ever built, Majesty. A pond worth fighting over is a prize. A pond too boringly, thoroughly *yours* to imagine otherwise is not even a thought in a gander’s head. Bore them out of the marsh. It is the only conquest that has ever lasted.',
  ],
]
