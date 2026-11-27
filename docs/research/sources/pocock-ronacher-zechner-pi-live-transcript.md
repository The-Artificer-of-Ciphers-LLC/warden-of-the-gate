# Transcript: "LIVE: Writing code that doesn't suck with the creators of Pi"

- **Host:** Matt Pocock. **Guests:** Armin Ronacher and Mario Zechner (Pi, Earendil).
- **Video:** https://www.youtube.com/watch?v=ZBTegd8DUZM (Matt Pocock channel, streamed live Nov 16, 2026, 46:15).
- **Written summary:** https://www.aihero.dev/armin-ronacher-and-mario-zechner-on-coding-with-agents~fn8vd (AI Hero, page shows "Updated Nov 24, 2026"; summary only, no transcript).
- **Copied:** 2026-11-26 from the YouTube page's transcript panel (machine-generated captions). Recognition errors are left as they are: the captions render Armin as "Amen"/"Armen", Earendil as "Arendel", Mario's self-introduction as "Gramps", "vibe code" as "wipe code", "Sentry" as "Century" and Opus as "OPOS". Timestamps are the video's clock. The chapter headings are the video's own chapters, which differ slightly from the AI Hero page's list.
- This is the speakers' own speech. Nothing in it is checked here; see [../TALK-PI-CREATORS-LIVE.md](../TALK-PI-CREATORS-LIVE.md) for what was checked.

---

### Chapter 1: Introductions and context

[0:00] for a couple of years and now I'm with Mario and Colin and the all the other Arendel folks working on AI stuff.
[0:10] Mario, hit it.
[0:12] Hi, I'm Gramps. I was silly and build a shitty coding agent, but before that I was also a longtime open source contributor. Um, also about 20 years,
[0:21] maybe even more, but mostly in the game development space. Um, and then in my bread and butter jobs, I was doing a lot of different things from ML engineering
[0:30] in the 2000s to gamedev to compiler engineering, uh, debugger building and
[0:38] startup adventures who came out luckily in my favor. Um, and then mostly back to
[0:46] gamedev stuff again. Building shovels is my my my thing. [laughter] Nice.
[0:52] So, and like Amen before we went live, you said something about the post opus
[1:00] 5.5 era. Now, I find that an interesting phrase and I want you to explain what you mean and what that era is.

### Chapter 2: The post-Opus 5.5 era

[1:12] So I think to me at least what has changed around Opus 5.5 and maybe for some other people this might be asked I
[1:19] don't know is that after a little while of working with the models I think there's a new level of I wouldn't say
[1:26] trust necessarily but like a I feel like myself and I think a lot of others found
[1:33] a new level of sort of baseline of where you can for a certain type of task let it run much more unsupervised for longer
[1:42] and you don't necessarily completely hit the end result. Um, so particularly for
[1:50] things like you have a reference test suite or something and you want to have like a matching implementation, they're
[1:57] [clears throat] sort of they're very good at sort of like grinding down uh for for long. I don't think it
[2:06] generalizes. Um, but there are definitely certain tasks you can do with these models now that I wouldn't have done before without
[2:12] looking. Um, and I don't think that translates necessarily to a lot of day-to-day kind of pi work. Um, but it
[2:21] it definitely it definitely allowed me to do a whole bunch of like side projects that previously I wouldn't have been able to.
[2:30] We we always come back to that. They're amazing for your side projects, but in part Yeah, they're definitely amazing for the side projects. Um yeah I think like yeah
[2:38] no go ahead I say like because like the reason there's always a caveat I think for work is that what we're doing we're we're trying to build something for people to
[2:45] build on top and I think there's just I wouldn't say like there's a higher bar but there's a like if anything we're
[2:53] sort of like being very careful that we don't accidentally ship something that we didn't intend on shipping [laughter] where on the side I don't really care if
[3:00] there's like three features in it I didn't really know were in [laughter] there because what you're building with PI, right, is you have a you're building essentially a public interface and so
[3:08] everything that's in that interface needs to be really carefully thought through. Mario, go ahead.
[3:13] Yeah, pretty much that. I mean, it's not just PI. Um, also in my other other bread and butter work, um, as I said,
[3:20] I'm building shovels and those shovels need to be sturdy and dependable. And you don't get that if you wipe code.
[3:26] Irrespective of whether your model is called OPOS 5.5 or Astro Fable 5.2, whatever it's called, I don't even care.
[3:33] My day-to-day job is basically just looking through or designing things systems or APIs
[3:40] and I I have not found this immense uh jump in capability from say 4.8 to 5.5
[3:48] in that area. They still suck at system design and architecture and and API design. Um where they have become
[3:56] significantly better is orchestrating sub agents and anything that is verifiable through tests or some other
[4:03] oracle. They will just pounce at that until the the right result comes out and where they have also increase uh improved [clears throat] was they don't
[4:12] lie to you. They are not um reward hacking as much anymore I think. Um, so previously goals, I give you an example.
[4:19] I I just for shits and giggles, I implement a goal in pi and then I had an agent try to inc decrease the startup
[4:26] time of pi, right? So I let this run overnight and I think that was a soul
[4:34] 5.3 or something. And in the morning I woke up and checked the the outputs and was like dude 10% uh decrease uh sorry
[4:42] 100% decrease in startup time. I was like, "Amazing. How this seems physically impossible? Do the the laws of thermodynamics no longer apply?" And I was like, "No, totally legit, man.
[4:52] Just started a new." And I like, "Yeah, it's cool." But nothing shows. Uh, did you just Yeah, I just ripped out all the modules basically. [laughter]
[5:01] It removed the application. And that was 5.3 or 5.2, I don't remember. And um, that's gotten a little better. um
[5:10] especially the cloud models aren't lying as much to you anymore as they did.
[5:13] There's a concept I think that everyone is noticing, which is that if you I I talk about this all the time, the split between tactical work and strategic

### Chapter 3: Tactical vs. strategic work

[5:21] work, right? Where tactical work, it's sort of on the ground. It's um focused on the day-to-day stuff. And then strategic is long-term. It's sort of thinking about how to win the war
[5:29] instead of winning the battle. Agents seem to be really good at tactical work is my take and really bad at strategic work. Is there anything Amen. I'll go to
[5:38] you again. Is there anything that you've tried that just did not work or are you just sort of like not not even thinking about that?
[5:49] I mean there are definitely some things that I tried that did not work and I where at this point I feel like okay this is surprising it doesn't do it. I
[5:56] think for me one was that um like Opus is really great at understanding
[6:03] art, not like making art, but like it understands like how color composition works and everything. It doesn't
[6:11] translate at all to being able to make music or like manipulate sheet music.
[6:15] That really surprised me and I feel like it was almost intentional that they didn't train [laughter] on it because they're music models for sure. Why why
[6:23] do the Opus family of models not do that? Um and obviously like I think like anything that involves um like really
[6:31] complex systems um I don't really have a lot of expectation that they come out right um
[6:39] without a lot of extra guidance. But at this point honestly I feel like there are more things that I end up being surprised that they work
[6:47] but then also sort of expect them to work then I actually have a good list of things where they don't really work.
[6:52] That doesn't mean that you can't get everything done. And I think like an interesting case like I had um I had a conversation with David Kramer um
[7:00] founder of Century and um we we sort of came to a conclusion that like Opus 5.5 makes really good progress in computer
[7:08] games for me it didn't make a lot of progress for progress for him and I realized like well I actually do have a game background so it's like the way I prompted like there's some very specific
[7:16] things and like if you don't prompt it down this path and I also see it with my son is adding stuff to our game it just doesn't come out the same way. So there's there's a ton of skill involved
[7:25] in prompting, but there's a little bit of like when you know in which order you want to do it, you're going to be more successful than if you have no guidance at all. And it's just like I don't know.
[7:34] Yeah. W with domain knowledge w with domain knowledge like both me and Armen have game gamedev backgrounds to
[7:42] some degree. If you come at it with that kind of domain knowledge, you seem to be able to tickle out uh the the the solution space within the weights that's
[7:50] specific to those like Three years ago, we would we would give all our our GPTs roles and and personas,
[7:58] right? But this is kind of the same just for a specific knowledge domain. And if you don't use the right terms, it will just not have access to that parts of
[8:07] its weights that give it that domain knowledge for something for some reason. So yeah, I don't know.
[8:13] Or it just or it just decides on a different path. Like I feel like one of the things where um they are I don't know this is sort of
[8:22] like conspiracy theory territory but like I think like it is in a lot of cases the first solution that they come
[8:28] to is technically a solution but it's the likelihood that that is the optimal solution is actually still rather low
[8:36] because you have to sort of give it the right trade-offs. Um but I think that also is a good differentiator between where are they
[8:44] good at and what are they not so good at. Anything that's uh ambiguous uh where there is no right solution where you need to bring in some kind of either
[8:53] experience domain knowledge or or just a gut feeling anything like that they really suck at anything where there's
[9:01] pretty much just a straight line towards the goal super nice super easy I I can trust them. So yeah.
[9:07] Yeah. I was watching um Lauren Tan's talk this morning from AI code and she talked she said that nuance often leads to slop right if there's any nuance in
[9:16] the problem then it will probably choose the wrong one. Right? So that means that when you're designing code bases and designing APIs you need to be really
[9:24] careful to try to avoid as much nuance as possible which I think is quite good.
[9:29] Now just because we touched on domain knowledge there I'm interested in like on every stream people will be asking these questions which is how does a junior cope like what should you be

### Chapter 4: Skills for a new age

[9:38] learning in this new age right because you guys obviously have 20 years experience doing this stuff um what how
[9:45] does what are the important skills now are there important skills are or are is coding dead basically uh Mario
[9:54] yeah so first you need to grow white hair facial hair irrespective of gender and then just pretend you know then you're good.
[10:02] Shave your head too. That and get glasses that really helps you. Yeah. And relocate to Oxford. Yes. Just sound very posh as well then.
[10:10] Oh, absolutely. Yes.
[10:12] No, I I I honestly don't know. I I still think for the foreseeable future learning fundamentals and talking to your peers um will actually give you
[10:21] that kind of experience you need to be effective at directing your agents. I I think that doesn't go away. Um, it's just there's a magic button now and if I
[10:30] was a junior I would press it all the time. So I I don't know it needs this discipline is probably the one thing you need the most if you want to succeed. M
[10:39] A Al Armen before we went on another thing you mentioned is there's this sort of push and pull between quantity and
[10:46] quality and Mario you were kind of talking there a little bit about you can push the magic button you can get a high quantity of code but then what is the
[10:55] trade-off basically when all code is cheap how much should you care about quality Amen

### Chapter 5: Quantity versus quality

[11:02] I mean I think like in the same way as sort of agents when you just prompt them you're it will never say that you can't
[11:09] do something. At worst, they're going to give you some sort of like this will take six weeks and then actually you're done in like two hours. So there's a I
[11:17] think there's a natural tendency to add every feature and like sometimes even if you don't ask it to add a feature it sort of it comes as a byproduct anyway.
[11:24] So like I think the default behavior of software is towards entropy towards having everything. Um, and I definitely
[11:32] I love the power of these things, but I'm much more interested if people are using that power to just build the best possible software and not so much the
[11:39] software with the most like things it can possibly do. And there's also there's a it's kind of hard to resist like a software that does everything.
[11:49] Um, because like I always wanted it to have this and this and this and now I have like the Simpson car as Mario always likes to say. Um, so I don't
[11:58] know. Like I'm also guilty of like adding too much stuff into like a lot of the things that I'm doing. Um but I'm
[12:05] like really collectively hoping that more people are just building really high quality and very ambitious software
[12:13] but not in terms of features but in terms of quality bar honestly.
[12:20] Yeah. I kind of feel sorry.
[12:22] Continue. I was going to ask you a followup.
[12:24] Yeah. Um I mean it's not like we had brilliant super awesome software before agents, right? But I'm also not of the
[12:33] thought that since that was the case, we should now also not care for quality. Um I I think now is the best time to actually care for quality because of lot
[12:42] of the treachery that took away time from you previously when you handcoded stuff can now be done via an agent. So
[12:49] you should in theory have more time to focus on quality and not quantity. But uh we're currently seeing the opposite still because everybody has AI psychosis.
[12:58] End of the day, it's going to depend on the business uh on on on the on the revenues that you can generate additionally by using agents. And I
[13:06] don't see that yet by going fool's home Simpsons car, but I could totally see that by improving service quality
[13:13] specifically in in domains where uptimes and so on so forth actually make uh financial make or break decisions. You
[13:21] know, not seeing that yet. I I I think we just need to figure out how to We still haven't figured out what the engineering process with agents should
[13:28] look like to create quality software and until we're there, we're just going to throw [ __ ] on the wall until something sticks. I mean, you're doing a lot of that work for us. So,
[13:37] I'm [snorts] throwing a lot of [ __ ] Absolutely. A ton of it. I mean you guys I'm the vibe I'm getting from you guys
[13:43] is like sort of um bearded skepticism basically and sort of a sort of sense of things are not things are not quite
[13:52] there yet right like we're not you know something is missing so what is missing is it just that the models are not good
[14:00] enough yet or have we not found techniques to harness the models that we already have like what's what for you guys would go like it sounds like you're

### Chapter 6: Trust and verification

[14:10] in a sort low trust space with agents, right? Whereas a lot of people are especially since Opus 5.5 came out are
[14:16] trusting them more and more or have sort of constructed harnesses constructed their environment such as using verification tools such as automated
[14:25] review to sort of bring the agents under control to give them fewer options. So how are are you sort of just like not
[14:33] trusting the agents at all or are you trying to build systems in which you can trust them? What does that look like?
[14:40] I'm gonna pick one at random. Amen.
[14:43] I'm not sure if this is a question of trust. Um because I I don't I like I I don't want a world where like
[14:52] okay maybe like you said I I have a very simple way of looking at the whole thing which is like if hypothetically these agents achieve AGI and everything is the
[15:01] same. This is the baseline like we have the this this all amazing whatever it is. I don't really care which bar it lands. Like we are not
[15:11] building software for like nonhuman things that are going to enjoy our software, right? Like or or anything in
[15:18] in life. It's it's here for humans, right? And so presumably the human element is always going to be there in one form another because like what else
[15:26] is the point of humanity? [snorts] So I don't really care that much about the agent in a sense. I care about that like whatever we're doing is actually really cool for society and does something
[15:34] really good. And so like a lot of the conversation about agents like is for me not all that I do want it
[15:43] to work better and everything like but I do like what whatever level it's going to reach. I really just care about like how do software engineers do the best
[15:51] coolest thing you can possibly do. And I think like it's always going to run up against like the limit of what humans are capable of doing. They're just going
[15:58] to do it with more agents. So like I I don't think there's ever going to be a point where I feel like now remove the human from this loop entirely. that to me is sort of completely uninteresting.
[16:07] So like how do I make the human in this loop work the best. Um so from that perspective I don't think there's a specific bar I'm always I'm going to try
[16:15] to figure out like how do you make that like how do you make the human in that succeed the best. Um and I think like regardless of how good the models are
[16:23] going to get there will always be a new thing to to try to figure out in that sense. [snorts] Uh for me it's still a trust thing. Um,
[16:31] but you learn what you can trust an agent with and what you can't trust an agent with over time that happens after each model release or you can also
[16:40] assume a base level with each family's new generation.
[16:44] Um, so to give you an example in PI there's like 40 to 50 new issues every day and we have a triage bot setup. My
[16:53] colleague David built that. It just lets the agent based on a very simple prompt investigate whether the bug is real,
[17:00] whether the issue report makes sense, try to reproduce it reliably and then propose a fix and also assign a priority.
[17:11] And we've been tuning this system for about a week or two uh based on old data and and some additional thoughts we had.
[17:19] And it's super reliable. like if I find an issue that's marked with P0, I can be pretty sure that's it's a P 0. And if
[17:28] that issue was also reproduced has a test that fails with the current code and a fix that runs um that makes the
[17:37] test pass, I have high trust that this is good. So in this case, I I can most often just sign off on the thing and
[17:44] merge the fix the agent suggested. In other cases where it's about adding a specific feature or extending a specific
[17:52] feature, anything that involves me as the user of the product, uh, results are hilarious. So, right.
[18:00] Yeah. It's not like we don't trust agents. It's just that the the there's rough edges and and and different domains where they excel, where they can be trusted and some where they don't.
[18:10] And I feel like the moment we have reached some level of new trust with it like you automatically aim higher and
[18:18] you find yourself again where where you kind of lose this trust because you almost take the one where you have trust with it that it works now for like for
[18:26] granted like the percentage of code we're reading on pi now is is much much lower but we also don't talk about it that much anymore because like of course
[18:35] it's like it's it's not going to litter is record all over the codebase anymore.
[18:40] Or maybe it still does. [laughter] I don't know. But but I stopped caring about that part for sure.
[18:46] So you have Okay. I mean because I think the amount of human review is currently the thing that's changing, right?

### Chapter 7: The role of verification

[18:52] Because earlier in the year it was the amount of code that we were handwriting, right? That has gone virtually to zero for me. I imagine it's gone to zero for
[19:00] you guys as well and has been for a while. But now it's how much do we review and how much are we blocking reviews going out? Especially now with
[19:09] like a public project like Pi obviously you have a lot of you know and with an interface that you have to take care of and that you have to make sure you know
[19:16] [snorts] there's no breaking changes on that's a big deal for you guys but how much are you looking at the code that goes out and how much are you looking at
[19:24] just the evidence the agent is presenting to you like in that I would call what you have a software factory basically in a sort of in I suppose it's
[19:32] sort of a very jargony way just turning issues into something and You're essentially just trusting that instead of having to read the code. And
[19:40] how much are you looking at the code of Pi anymore, Mario?
[19:43] Um, quite a lot. I also look at diffs for these issues that get auto fixed.
[19:48] Um, but my my superpower is that I know the code base of Pi and I still know the
[19:55] codebase of Pi after 12 months of agents fixing issues because I actually also look at the fixes. That isn't true for
[20:03] everything. Like we we have an HTML export of of session data. I don't care what the code looks like. [laughter] If
[20:10] the end result is correct, I don't care how it works, right? But if there's anything that is related to how the tools work, their
[20:18] implementations work, or how the agent loop works, or all the core primitives, right, that need to be stable and and good. I still look at the code. I I I
[20:27] have not given up on that yet. all of the code or some of the code or are you sampling or how does that look?
[20:34] Um, again, if it if it really touches a subsystem that I know is like super super important, I read the entire diff
[20:41] obviously. If it's something where I have a general idea of what it should look like to fix, um, I might just skip over a lot. Um, especially for non-m
[20:50] mission critical stuff, then I don't look at all because I don't know whether whether whether something has one
[20:58] additional white space or so on and so forth. I trust the agent with that. Yeah.
[21:03] So, Mario, I'll stick with you because I I would It seems like both of you guys are a little bit lax or you care less
[21:12] about things like verification than I [clears throat] do. So, like putting the agent in an environment where it can
[21:19] succeed and constraining it, giving it fewer options, um not allowing it to create nuance or or make decisions or
[21:28] things like that. And before we went live, you said the rather intriguing sentence, verification is overrated.
[21:35] What What on earth do you mean? I want to know.
[21:38] So, first of all, I want to say that Lauren is super awesome and I like every bit of her output, and I'm not pointing that at her at all.
[21:46] It's just that I know too many people that get themselves that if the agent has written a metric ton of either linting rules or unit tests or end to end tests and so on, the system is good.
[21:55] It's not. [snorts] [laughter] And the reason for that is that they are still goal seeking, reward hacking little bastards and they will just lie to you. That's still the case.
[22:03] Or they will measure the wrong thing or they will measure not enough things. Um and unless you have a very good insight into what's actually
[22:12] been is happening underneath the hood, you have no idea if your verifications are actually worth anything. And I would
[22:19] posit that most of these things are mostly not good. [snorts] Amen.
[22:26] I mean I I think like um so first of all I think like we we rely on verification a lot right it's not like hey pi is full of unit tests and
[22:35] like every single project I've ever worked on has a lot of like things to rein in on like what an agent is supposed to be doing and not supposed to
[22:43] be doing but a lot of things just are inherently quite hard to
[22:49] verify and I I think like I I did a lean proof on a bunch of things in pie and afterwards like why did I do this because like now I need to like what's
[22:57] the mechanism by which my proof is going to no [clears throat] because I was interested like can I build something
[23:05] where like I keep the source sort of in line with the proof and I also built um for like one of our hypothetical
[23:13] components we might or might not want end up using I built a system that basically um like uses a meta language
[23:22] like a mini version of TypeScript as an input language to then transparent to other systems because it allows me a certain level of control that I wouldn't
[23:29] do have in other cases and it is very interesting but it doesn't really solve anything at the end of the day it just
[23:36] gives you the agent another thing to utilize but so far with how we're doing this most of like unless you write code
[23:45] in Okamel most of the software verification like verified code ends up being another artifact for the agent to look at and not yet at least to the best
[23:54] of knowledge, it doesn't yet end up being like an intrinsic part of um of what really fundamentally constrains the agent. Um

### Chapter 8: Adversarial review processes

[24:03] so I like I think there is a world where software verification will work. Um
[24:11] I I if someone has found a great like actual end to end software development experience that lends itself to that,
[24:18] I'm really curious. um I have one counter point coke or whatever um and um and and lean
[24:27] so far from the tests that I've done and we're like I haven't yet succeeded in like introducing it as a proper piece in what we're doing. [snorts]
[24:34] The the the halting problem is real and it can hurt you whether you use lean or coke or whatever doesn't matter. It's also a question of what the unit is that
[24:44] you're trying to verify. I can easily verify some pure functions. That's easy enough.
[24:50] I cannot verify end to end as of a full system. It just doesn't work. And just because your individual modules verify doesn't mean the combination of these
[24:57] modules verify. So I don't think there's a way for full program verification unless we are talking about things like in the aerospace domain and and other
[25:05] regulated industries and businesses where this has been a thing for decades.
[25:10] But you have to look at what they're actually doing, how they're verifying things and how they're writing things knowing that they need to be verified.
[25:16] none of the code we are writing is in any way, shape or form uh um in line with what the aerospace industry for
[25:23] example does. And so yeah, I again I think we're mostly kidding ourselves.
[25:27] But on the other hand, anything is better than nothing. [laughter] Um you just shouldn't have a sense of security just because there's a bunch of
[25:36] clean code on your disc which doesn't even [laughter] prove what you think it proves.
[25:40] Yes. And because the CI is green essentially.
[25:43] Yeah. Exactly. So like I think that's always been a thing, right? Like there's always been an element of how far can you get with deterministic tools.
[25:52] Farish, but not far enough, right? And it's probably never going to be far enough.
[25:58] Do you employ any kind of like AI review on top of that? Like to give you an extra level of security?
[26:05] Again, I wouldn't call it security, but I would call it insurance against my laziness. [laughter] Yeah.
[26:10] because when prompted correctly, an agent can be ruthless and tell you this is real garbage. Um, and so using adversarial reviews is is really really
[26:19] important in my day-to-day work, specifically when I do a system when I do system design. Um, and in that case, I'm just basically using the age-old
[26:28] wisdom of ensemble methods. Like back in the 2000s when I did basic ML, ensemble methods were super invoke. So you can apply the same today. you you take
[26:36] different uh model families and have them each review the same thing with the same inputs and you will get super
[26:44] different answers and super different um problems that get identified and that that's immensely helpful. The problem
[26:52] with that is if you if you tell them to be sellers or whatever it's pronounced.
[26:56] Sorry, my English is not perfect. Um they will be overzealous and that can also hurt because then they identify things that are not really something
[27:04] that you need to think or care about or fix even. Um so you're still in the position where you then have to filter down whatever they reported as problems um using your own judgment.
[27:14] Yeah. Like you're always going to get false positives in um any kind of automated adversarial review. It's kind of like the name of the game. you know, you're it's always it's always going to
[27:23] produce something and sometimes there's not actually that much. I have people that sort of run it in a loop until nothing comes up and I think that's just the sort of then we have the largest possible ever.
[27:33] [laughter]
[27:33] Absolutely.
[27:34] Well, you know, and the and the comments as well and they're just, you know, they're just slamming each other, you know, knit knit knit. That's brutal. A
[27:42] big problem with this is that um I I I don't know to which degree on new models is not so much of an issue
[27:50] because like I'm tending to steer away from this now but I think like they they have been trained at one point of best practices and a lot
[27:58] of back best practices are can be actually bad.
[28:03] [laughter]
[28:03] Um, I I'm a huge believer in reducing complexity in in systems, but a lot of best practices are like protect against
[28:11] every bad input and like like be defensive programming everywhere and and I think they're they took this to heart
[28:20] and if you're if you just let it do its thing just you increase the system
[28:26] complexity quite a bit still. Um, and I've I've also noticed like as I'm doing a lot of security research at the moment on like making sure that our [ __ ]
[28:34] doesn't completely fall on its floor if someone were to do something bad with it. Um, a lot of the extra
[28:44] protection that it puts in can make it believe something is secure and safe when in reality like it misses
[28:52] like a here's a here's a big thing that you missed but like you think it's okay because this is here. Um, so like
[28:59] simpler systems tend to be easier to understand over time and like agents still produce. I'm pretty sure that
[29:06] because human laziness tends you to like make more compact code than what the agent is doing. If we were to like put an agent versus a human head-to-head to
[29:15] solve one problem, it might actually come out that the human code is sort of like long-term easier to maintain in the absence of an agent. I wouldn't be surprised of that.
[29:24] Right? Because coder is harder to produce, you think more about it and yeah.
[29:29] Yeah, I I see that. So like if so let's I think the one thing that a human would be better at is sort of
[29:38] thinking strategically, thinking tactically and strategically at the same time. And hopefully if they're a good coder, they will make choices that will improve the system design over time.
[29:47] When you're thinking about system design, both of you have a lot of experience preAI and during AI. what

### Chapter 9: Systems design philosophies

[29:54] techniques like can we just sort of mine you both for your domain language so that we can feed into our prompts please that's that's the dream for [laughter] me because like for me it's like I'm
[30:02] thinking like John Asterout deep modules you know interfaces you know seams blah blah blah blah blah like what techniques are you interested in what have you
[30:11] found works maybe giving agents the right ideas about system design either of you jump in on this I I let me start because it's entirely
[30:20] unspectacular um for me this is more an artisan endeavor than a structured engineering thing. Um, I need to feel a
[30:28] solution space out before I can create a solution. So, previously I would write little programs, little APIs, the types and so on and have a scratch file where
[30:35] I experiment with what I've written so far, see how it feels, see how where it falls apart. Now, the agent can take that over for me and just write not just
[30:44] one version of the thing uh within the solution space, but 10 and I can explore them all at the same time and that's
[30:51] really great. um I I get to see a lot more of the problem than I would have with just me as being a sole programmer
[30:58] who can only output so many lines of code a day, right? Um and that's that's basically it. I'm I'm just iterating. My my whole life as a programmer was
[31:07] iteration, iteration, iteration until it feels simple enough yet capable enough for what I'm trying to do.
[31:14] It's hard to That's not a prompt, is it? I can't say um you know, I'm feeling this, you know.
[31:20] Yeah, it feels good, man. H A Al Armen, you got anything?
[31:24] I mean, I think like the last 10 years, maybe 12 years, give or take, a lot of my life has been related to like building and operating a SAS software.
[31:34] And I think u when you do that eventually you internalize this idea that like really
[31:41] what matters the most is that [snorts] when things go wrong. Ideally the software was written in a way where not doing anything doesn't make it worse.
[31:51] Well like you you remove the element of of like um you have to act now. So like create yourself some sort of like
[31:58] switches and toggles and all kind of stuff you can you can sort of press in the heat of the moment to create a little bit of a breathing room here. Um,
[32:07] and I don't know necessarily that there is a magic prompt you can
[32:15] give to an agent to do that because a lot of it has to do with like um
[32:23] like really good understanding of like what kind of data flows for your system, what the volume is that it has because like a different volume have different
[32:29] trade-offs. Um, so there's there's a lot of contextual information that also changes over time. Like hilariously
[32:38] enough, like I had a I had a sort of a situation um that I had to look into last Friday and the a and this is on a codebase where the agent actually sort
[32:47] of willingness to maintain uh some doc files with length findings. And then as it was sort of reading through this, I was like this is this is very weird.
[32:55] Like why why do you think this? And I was like, "Oh, because I found this file here and it says there are only 2,000 records." And I was like, "Yeah, you wrote that file when the database was
[33:03] empty." [laughter] So, um, like things change at this point. The database is no longer 2,000 records. At this point, it
[33:10] has millions of records. And so, um, like and you do completely different trade-offs depending on this. So, I don't know. I don't think there's
[33:18] anything really to to share here other than um yeah like
[33:25] when you build SAS software then you want to you because at the end of the day I think like you're you're still going to be on the hook if [ __ ] goes wrong, right? And so like the goal is
[33:33] still the same. It's like if things go wrong I the agent is not going to feel my emotions. It's going to be me.
[33:41] Yeah, pretty much. I I mean I think Armen and I I mean we've we've some shared history and what things we've worked on but I was more on the client
[33:48] side and more on the graphics programming side and Armen was more on the big fat irons in the cloud and they do a lot of very important and very
[33:55] pricey things. So we might have some uh different views on things but I think what we're trying to do here or what the industry is trying to do here at the

### Chapter 10: The dark factory concept

[34:04] moment is running away from understanding. And I don't get that. I that makes no [ __ ] sense to me
[34:11] because if you do not have to understand anything anymore, what use are you for?
[34:15] Like why do why do I need you? If I can just prompt my software factory, I don't need to pay you. I'm going to fire you.
[34:21] In my day-to-day work, I don't see myself being useless just yet. I'm not ruling out that it's going to happen, but it's currently not the case.
[34:30] But it's unclear to me like why it's desirable in the first place. Like what do you actually fundamentally gain from
[34:36] operating at such a scale that understanding evaporates in a company?
[34:43] Because seemingly that is that is the goal in a way is like you're like how do you scale up that element so that humans don't have to be in a loop anymore and
[34:50] like the the real answer is like anything that will happen at any point in time someone will have to run to an agent to like figure out what's going on. Um,
[34:58] I mean, we already have that. We We already have peers of ours that say in during an incident meeting, nobody knows what the [ __ ] going on. They're all
[35:05] just prompting their clot. That is [ __ ] scary. I don't know if you remember this but like I think it was about four years ago Facebook accidentally locked themselves out of
[35:13] the headquarters and they don't really remember this and it's like the the entire because like I I don't exactly remember the story but I think like
[35:20] ultimately like one of the switches failed or something and then eventually there was a cascade of failure and they had like for the first time they had to like really sort of like from first
[35:27] principles figure out what was going on because like there was so much stuff that was standing on top of that and this sort of like level of catastrophic failure and being able to defend
[35:36] yourself against that Like yes, maybe this sort of happens only every once in a while, but like there's a reason why companies are supposed to have disaster
[35:44] contingency plans. And this is very weird to me to imagine that there will be like a Fortune 500 company is like, "Yeah, our plan is to have another
[35:51] backup of another coding agent over there and we're going to [snorts] run it on like an generators and [laughter]
[35:59] it's so I don't know. So I guess what what I want to ask you guys what I want to ask you guys is like
[36:06] someone let's say someone is asked to justify their job right someone is being asked to say okay you're going to you're
[36:14] planning on firing me I can feel it right or you're going to fire like five people in this team um of 10 maybe
[36:22] why what is the argument to say that the human is not or is needed like why are they needed is it just like disaster
[36:29] contingency that doesn't feel very strong like like it's got to be some it feels like something more than that right we've sort of mentioned oh yeah you can use domain knowledge to kind of
[36:38] like tweak the agent so it sort of you know it gets the right parameters going like what is the right way to make that
[36:46] argument let me start by saying I'm not making that argument as much as it hurts me to say I I think for a lot of task in

### Chapter 11: Justifying human value

[36:54] software you don't need humans anymore it's just matter of fact um then the question becomes How do you retain your value in a market
[37:03] that can be replaced by machines?
[37:08] For me, the answer is easy because I'm old, so I have a lot of experience and that is still something that seems to have value in the market. For uh younger
[37:16] people, I don't know. I honestly don't know. I can just say people like me are going to die soon and then we still probably need some people that that watch over the software factory and they
[37:25] still need to know or have at least some surface understanding of what the [ __ ] going on. So that's going to be you youngans. Uh so you better better get to
[37:33] know things. [laughter] Um but I I honestly can't can say there's an argument for every software
[37:40] engineer in the world to retain their job.
[37:43] I think like if someone is going to run up to you and say like hey you need to justify your job. um like you have already reached a level of like I'm I'm
[37:51] running regardless of if I'm justified to this company or not because like something went so wrong [snorts] like like I mean that's
[38:00] obviously this is easy to say for someone who probably has some level of job security but like I think it's actually sort of important that um that
[38:08] people do that um because I think of course you're never going to be asked that explicitly but you might um feel a sensation in the company you
[38:16] might get the sense that things are not going well. There might be a round of layoffs where you're not affected and then maybe there's a next round of layoffs coming and you might be sort of
[38:24] tend to post a little bit more in the group Slack about the things that you're doing or you might just be a talk a little bit louder about your achievements.
[38:32] Yeah. Specific achievements at that point.
[38:37] Yeah. Yeah, because like if you ever feel like on a daily basis you have to justify what you're doing like vibes are off really.
[38:48] Yeah. Yeah. And and like and like because it will also like fall back on you in a way like because at that point you're like you're less motivated of actually figuring out like what you're supposed to be doing at the company and
[38:57] you're spending more time on like justifying your existence. And if you have reached that level
[39:05] I don't know like I would I would reach at an earlier point and trying to figure out like if what I'm doing actually no longer delivers value and I sort of feel
[39:14] like that might be the case then where do I move where I do deliver value? Um, yeah, I think that might be changing every three months, right?
[39:23] Historically, we neck beards try to avoid talking to other humans. And I think that's the one thing that will will actually up your value in the
[39:31] market. Like I I I've never been the the prototypical developer. I actually like humans. I actually like talking to humans. So that puts me in a position
[39:39] where I can just be more than an engineer, let's say, more than a coder, right? I can kind of sympathize with my
[39:46] users, for example, and better understand what the [ __ ] they actually need.
[39:50] Difficulty level impossible. Yeah, that's always felt really powerful to me as well, like in my career, too.
[39:56] And and I think that's something that machines at the moment at least cannot quite replicate yet if you're actually good at that as a human, right? Lots of humans suck at
[40:04] people hate talking to the machine. So I want to I want to pull us back to sorry I want to pull us back to code a little bit which is there's this and we've got
[40:12] maybe time for just a couple more questions I think and this one is there's a phrase going around called a dark factory right which is the idea is
[40:20] you have a software factory and it is just essentially operating by itself you never need to look at the code never need to turn the lights on I'm
[40:29] interested in whether you think it's possible now whether it's possible for certain things now and whether it might
[40:36] become possible in the future. I don't like to generally do a bit of punditry but you guys are sort of leading me in that direction. [laughter] Okay, let me let me start by answering

### Chapter 12: Future outlook and wrap-up

[40:45] and saying uh if somebody can make that work and it has economic value then it would exist. [snorts] I have not seen it existing yet.
[40:56] Yeah. Amen.
[40:59] Yeah. I mean I I think it's interesting people try for sure. the example that I had recently on on this uh in preparation for the talk that I gave at uh AI engineer.
[41:12] I had this discussion with a friend. I said like look I actually don't think anyone fully operates this like issue tracker that sort of like gets issues in
[41:21] and then auto fix and it's like he said like oh I do. I like so are you still using it? He said no. Like do you not mind that it wastes tokens? Like yeah
[41:30] actually should turn it off. That's what I was. [laughter] I mean, [gasps] it really only matters if if someone cares. And if we have it
[41:38] fully automated and you're [clears throat] not even looking at yourself, then it's like, yeah, it's technically a factory, but it is it I mean, it's fully on autopilot, then
[41:47] it's like whatever. It's like turns out what the weights are doing. I don't know. I I wasn't at AIE in San Francisco.
[41:53] Armen was, but as I understood, Steve Yaggi gave a talk there where he basically told people to slow the [ __ ] down because software factories all end
[42:01] up in a mess. And that coming from Steve Yaggi, the OG slopmaster 2000 says something, right?
[42:08] But he also supported the existence. He sort of like he argued both ways, which to me is the most fascinating thing on the whole thing. [laughter] I don't even think that contradicts each
[42:17] other. I mean we will maybe in the future have something like dark factories for some specific problem domains. I'm absolutely not ruling that out. Um so we need people to experiment.
[42:28] We need people to to figure out if this can work. And again it needs to have some economic value attached. Otherwise it's just wankery.
[42:35] Yeah. And there is some problems that it would be better for than others. Right.
[42:39] like if you you know if a pure mathematical domain let's say is going to be more tractable for a software factory then um you know even like a I
[42:49] don't know even like a very basic CRUD app at this point I think would fall apart pretty quickly and um so okay one more question I kind of want
[42:58] to make it a good one so if you're h what is this good question.
[43:09] Okay, I kind of want to ask how uh knackered are you guys feeling like at this point? Because the way our job has
[43:16] shifted is ridiculous. You know, it's it's gone from okay, we make some decisions and then we type out some nice code and then we go back to thinking
[43:25] strategically again. And like we're just forced into this strategic thinking mode all the time, right? At least that's how I feel. How are you guys feeling at the
[43:34] moment? How are you doing? Are you more tired than you used to be? Have you adjusted? What's the vibe?
[43:41] You start aring um I had um I don't know like two weeks ago I found this article on the internet
[43:49] said like the wives of AI husbands or something like this and it was basically this [laughter] and and I shared it with my wife and she's like you're in this article.
[43:58] [laughter]
[44:00] See I didn't share it with my wife.
[44:04] [gasps and laughter]
[44:04] Um, look, I think I definitely don't sleep enough. I definitely um and I don't even know why.
[44:11] Well, I mean, you're also founder of a startup, so I think that's not necessarily just AI stuff. So, but um I don't know. It's like it's the
[44:21] it is simultaneously the coolest time and the most confusing time and the most weirdest time. And so, like you have an
[44:28] urgency to experience it all as it happens. And as a result, you put more stress on yourself. Um,
[44:36] but I'm coping. [laughter] Good.
[44:42] Yeah. Um, I mean, both Armen and I and Peter Steinberger have been at this since early last year, and I think we
[44:50] got our AI psychosis out in the summer of last year.
[44:55] That was also when I didn't sleep a lot, and now I'm much more relaxed. I don't think a lot has happened actually in the last 8 months or even 12 months. Um I I
[45:05] I don't see a big shift anywhere anymore. I just see a lot of people in organizations still struggling with how
[45:12] to build proper engineering processes around this new tool. And I don't see anything anyone succeeding yet. Not not in a way where I say this is the new
[45:20] pattern and you should follow it. I mean I should probably check out all of your material Matt. Um, maybe I [laughter] maybe there is the the silver bullet in
[45:29] there somewhere, but I think people like you and and the guys from human layer and so on, I think that's super valuable. I think that's where we
[45:36] actually need to go as an industry. Um, so that that's the I I'm not sleepless because of AI
[45:43] anymore. I I don't care. [laughter] I've seen enough.
[45:47] Yeah, I um I've been trying to manage my AI psychosis, I think. you know, like I'm receiving treatment for it. You
[45:55] know, [laughter] I'm feeling I feel okay about it, I think. Well, guys, we said we carry on till 10 past. I don't want to keep you any longer. Um,
[46:03] thank you so much for joining. This was really fun. Yeah. Not at all. Um, we've got about a thousand people watching live, which is crazy. Um, thank you so
[46:11] much for joining along and I'll see you guys very
