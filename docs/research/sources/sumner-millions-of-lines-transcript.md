# Transcript: "How to Ship Millions of Lines of Agent-Written Code" (Jarred Sumner, Anthropic, AI Engineer)

- Source: https://www.youtube.com/watch?v=TvsF67C2F54 (channel: AI Engineer; published 2026-11-24; 22:29 long; 16 chapters named in the description)
- Captured: 2026-11-25, copied by the agent from YouTube's own "Show transcript" panel (auto-generated captions; the video player itself showed "Video unavailable" in the agent's browser, but the description and transcript loaded). Caption lines are joined into paragraphs; each paragraph carries the timestamp of its first caption line. Timestamps are the panel's. Caption errors are left as they appear ("Jared" for Jarred, "Bung" for Bun, "Enthropic" for Anthropic, "cloud code" for Claude Code, "web kids test" for WebKit's tests, "test 262" for test262, "Fuzzili" for Fuzzilli, "Jetream 3" for JetStream 3, "sub aents", "longived", "reme-measuring", "bun upgrade- canary"). The slides are not in the transcript, so "these were prompts", "this one" and the benchmark numbers refer to slides the agent could not see. Treat any name, figure or product taken from this text as unverified until checked against a primary source.
- Description (as published): "Jarred Sumner, creator of Bun, recently merged a PR of several million lines that adds an ahead-of-time compiler to Bun, the runtime behind Claude Code. It went through five rewrites in about a month, and the result uses about 4x less memory and starts about 2x faster. He explains why the team made JavaScript faster instead of rewriting Claude Code in Rust, why tests that predate the project are what make agent-written code trustworthy, and what he actually does all day while 140 agents write code."

## Chapter 1: A multi-million-line PR for Bun

[0:01] [music]

[0:12] Hello everyone. My name is Jared. Uh I'm the creator of Bung. Uh and I work at Enthropic. Um uh

[0:22] Bun is the JavaScript runtime that powers cloud code. And recently I merged a several million line of code PR um to add an ahead of time compiler uh to to bun which is uh basically the idea is uh instead of paying the cost of a JIT at runtime you can uh uh you can compile all the code ahead of time. Um and it's it's like a really big project.

[0:54] Um over the summer I uh rewrote bun and rust. Um uh and this is a project on a larger scale. This ahead of time compiler is like a larger project than that. Um and I think one of the challenges right now with large projects is like how do you actually confidently ship a mill like millions of lines of code written by agents. Um so that's what I'm going to talk about.

[1:23] This was like the opening prompt after some discussion with it was like basically uh we need to make cloud code use a lot less memory and uh and faster and we can modify either webkit or bun. Um bun uses JavaScript core which is webkit um under the hood. Uh and it's

## Chapter 2: Five rewrites in a month

[1:45] been a little bit over a month. Um uh uh this is this compiler has gone through five rewrites. Um you can see the like the first couple ones were like pretty short and then I like almost shipped the blue one. Uh and then I was like this is building way too long. Like it's taking way too long to compile the code. So rewrote it again. Uh and this next one is shipping next week.

[2:18] Uh this is kind of the way I think about a project like this is like you're really constrained by how you test that the code works. Um so that's like even more important than what you're specifically

## Chapter 3: Testing decides the approach

[2:33] like like the approach you go with for how to build it is entirely driven by how do you verify that it actually is going to like work and not be buggy and that you can trust it.

[2:42] Um and so just a little more background on like like why this particular project why the ahead of time compiler and it's because uh for a typical JavaScript based application roughly half of like this the CPU time is just spent compiling code on demand.

[3:02] Um and so a lot of the general like thing you you've seen in a lot of applications where people are rewriting their code bases in in a language like Rust or sometimes Go um it's like when coming from JavaScript it's because uh like there it's really the the combination of the JIT and that it's a single threaded application.

[3:25] Um so that's sort of the difference between a JIT and AOT is that uh you compile before whereas with a JIT you compile as you go along.

[3:38] This is particularly important for something like cloud code where when using like the cloud code like iOS app where the CPU time is a lot uh if you're if you have to have every session of cloud code also compiling um so we talked a lot about like like

## Chapter 4: Why not rewrite Claude Code in Rust

[4:00] should we rewrite cloud code in Rust um because the bun team us rewrote bun in rust So like we're pretty good at rewrites. Um uh and we decided not to.

[4:16] Um and the the reason why is because like for in bun's case it's actually like pretty easy to do like bun is an easy project to do a rust rewrite because the tests were written in a language that's independent of the one it runs in. But so because all the tests were written in Typescript um we could run the tests on both the zig version and the rust version whereas for cloud code uh we like cloud codes tests are written in typescript. So we would have

## Chapter 5: 4x less memory, 2x faster startup

[4:46] to port cloud codes test suite and as soon as you're like rewriting the tests then you can't really trust the tests anymore. Um so that seemed like it'd be too risky.

[4:59] So instead, what if we just make JavaScript faster so we don't have to rewrite it in Rust?

[5:07] Um, this was another prompt a little bit later. Um, uh, and the result is that it actually did uh have JavaScript's memory like the memory usage uh, it uses about 4x less memory. Um uh it starts about two times faster. Um uh and we we're dog fooding this internally and it'll be external soon.

[5:40] Um some more benchmarks uh and then I'll also go into more detail about how we actually did this. Um so like it's it's possible that if an interesting thing is like like TypeScript 7 rewrote their code by by hand um from uh JavaScript/TypeScript to to go and uh the singlethreaded version uh with you when compiled via bun compile is now faster than the singlethreaded TypeScript Go port. Um

## Chapter 6: Types as predictions

[6:15] and we will add threads also to the ahead of time compiled version of bun but we haven't done that yet. So there is a PR.

[6:24] Um and so a little bit about like the actual ahead of time compiler um uh typescript is not the type types are don't necessarily need to be correct. So it treats types as predictions uh instead of like trusting them.

[6:43] Um, and this kind of problem works really well for models because uh they're just really good at writing compilers. Um, so so uh uh this is sort of like more about like

## Chapter 7: Tests that predate the project

[6:58] how how uh like should we like how we were thinking about this decision. Um, and a a big thing here is like there's so many tests you can run when you're when it's like uh in ahead of time like like for something like this because we don't need to write any tests pretty much ourselves. Like we actually do write a lot of tests but uh we can largely trust that the tests that predate the project work.

[7:22] Um, and this was the same thing with the the bun rust rewrite where we had buns existing test suite we could run and now with a compiler uh we have bun's existing test suite plus web kids test plus test 262 plus cloud codes tests um and then we also made it so that way bun itself the bun's own test runner could be run in the AOT mode uh

[7:52] and like the we have one breaking change with or relates to two breaking changes with the ahead of time compiler and that's pretty much why these particular tests are failing. Um but the and the two breaking changes are actually like mostly security things um to prevent prototype pollution attacks but they also end up benefiting for performance.

[8:16] Um so like what makes this particular kind of problem pretty good for agents is like uh you run it with you can run all three versions of an application. One with a JIT, one with ahead of time compiled and one also without the types and as long as the three of them uh

## Chapter 8: Three versions that must agree

[8:34] behave the same then you know that it works at least for that specific application. But then you can take that kind of problem and fuzz it a lot. Um uh and just have Claude like turn out code generators to like fuzz different patterns. Um and you can catch a lot of bugs that way. Um

[8:58] uh this is a very large project. This is the biggest I think I've worked on uh in terms of like code volume. Um most of this is tests. Um and also because we rewrote it five times. um when you're like doing this

## Chapter 9: Write in batches, then fix

[9:16] kind of project what how I think about it is like you have like batches of like okay we need to write a lot of code at once and then after that initial batch then it's okay let's have let's like fix everything make sure it compiles make sure it passes a bunch of tests um and make sure it like really truly works um and the actual logistics of that are like when you're in the big batch kind of project stage, then uh you don't want to run builds. You want to run one build because otherwise you're going to spend all your time compiling and like waiting for build errors and it's going to like not be a good use of anyone's time.

[9:55] Uh and then separately uh for like longer running like once you have once you've written all the code uh you want to uh have it like have lots of individual agents. Um this is like a little bit of the timeline um of this project. Uh

[10:23] the first one was not very good. Uh like cloud code was a gigabyte. Um which is terrible. Uh uh and like this used as much as possible from JavaScript core's existing code. Um so it was like basically the ceiling was what is is like only as good

## Chapter 10: When the code was slop

[10:46] as like what it could be from that. Um uh so then a little bit after this we added a TypeScript type checker into bun itself. Um these were prompts uh uh and so we added bun check and then we're like hey Claude please use bun check. Um uh and then after that startup time got two times faster and uh in cloud code and uh started using about 3x less memory

[11:22] but the code was slop uh and like like this is not good. it should never basically this meant that any object that accessed a property called archive it would then assume that the bun.archive API was potentially used. Um and I looked at this and I was like we cannot ship this. This is not good. Um so then uh uh

[11:54] this is like yeah and that this is another thing too is like it just like when you're doing like a large planning like when you're starting to like have it do a bunch of design docs and stuff it just loves writing markdown docs and it doesn't make sense because who's going to like 1500 markdown files It's just not reasonable.

[12:18] Uh uh so for this it was like and this was

## Chapter 11: 140 agents at once

[12:26] like I think the third compiler version maybe it was the fourth. No this was the third. Um uh it to like just to kind of batch get it all out uh 140 agents at the same time write all the code all at the same time. then get cloud code to run. Um uh

[12:51] and then uh this is the fourth one. Um and this one the code was not slop um pretty good um with like basically the same performance as before. However, the compilation time was way too slow

## Chapter 12: Build times and the fifth rewrite

[13:07] because people coming from like a JavaScript background don't expect any compilation time. Um uh so 50 seconds for like cloud code is like a pretty large codebase but this meant that like other projects would take like single-digit seconds and people don't want to wait that long. Um so uh we're going to rewrite it again. Um and

[13:35] and uh cuz in in older versions of this compiler, it was taking like 10 to 20 seconds. Uh and then cloud does this thing where like it'll try to like size up everything to judge whether or not it's worth working on, but it's really easy to convince yourself that like your measurements are good um when they're not good. Uh uh and like part of it was also like why is this 900,000 lines of code? This should be a lot like smaller. Um

[14:13] uh so then we did it one more time. Um and the code was good and the build time uh was under 20 seconds. Um, it's possible that we end up with a sixth time sometime later, but the fifth one is like very shippable and I've worked on this for enough time that it's like time to ship it.

[14:43] Um, a lot of this was like just like, "Hey Claude, try this idea and then see what happens." And then it would like size up the idea. Um, and I think this is like still kind of not right. Uh, like I think a lot of this are like things that we should try again and not let it like kind of what I said earlier about like uh sizing up the the impact of a change is like it's really easy to underest or to like size it up incorrectly and then talk yourself out of it. Um, so I think this probably needs to be revisited more.

## Chapter 13: Long-lived subagents

[15:21] Um my old approach particularly with like the the bun rust rewrite was very much leaning on like cloud code workflows to do things. Um and pretty much now with the most recent models uh I mostly just rely on sub agents that are like very longived. Um except for that initial part where you're like writing all the code all at once. Um, and this with the sub aents it works pretty well because they keep all the context of the relevant code in their head or like in the context window. Um, uh, and uh, that's like less wasteful. Um, and like they can just keep going. Um,

[16:10] here's a little more about like how the different parts of the compiler works. Um generally it's like there's if we can confidently prove that uh the value is like the types are the same that they're monomorphic then it can become a field access otherwise it has to check every single time uh uh and it has like some inline caching but not like a lot. Um

[16:37] uh as with a project of this size, you really do need to it's kind of hard to follow sometimes like what everything what everything's happening. So uh I lean a lot on like just having an hourly update.

## Chapter 14: Hourly scorecards and fuzzing

[16:52] Um and where it would post a scorecard comparing a bunch of metrics that we were prioritizing. Um, usually though when it was posting in Slack, it would show like a previous and this version so that way it was easy to see if numbers went up or down. Um, but it's like not helpful in a slide because the previous one is just legit.

[17:14] Um, the the important thing is like none of these tests for the most part are things that are like made up. um uh they're things that like pre predated the project so that way we know that like the agent couldn't have messed with it.

[17:36] Fuzzili is like a JavaScript engine fuzzer that V8 uses. Um so uh and we were already using that in bun but we also extended it to have uh to like test for TypeScript types um as well. Um uh and it's also important to check that the tests actually catch things because it's really easy to fool yourself that it's finding bugs when it's not finding bugs.

[18:07] Some more numbers uh on the ahead of time compiler. Um it generally for most projects outperforms the JIT. Um not always. the you can see in the uglify.js case and that's basically if it has to use the interpreter a lot. So if there's a lot of like eval or a new function um then it's not faster. Um but most applications don't do that. Uh and it's like it's like a make it like it's as close as possible as you can get to like a oneliner to like make an application run faster. Um this is not 100% true because as you can see uglifyjs and there are other cases as well. Um but it is often true.

[18:56] So like yeah the other thing is object prototype. Uh this is like a rare edge case but basically there's a lot of security vulnerabilities in JavaScript applications called like prototype pollution. And this usually works by assigning properties onto object.prototype.

## Chapter 15: What you actually do all day

[19:12] Um, and the compiler bans that.

[19:18] So like for a large project like this, what do you actually do all day? These were like the top messages that I sent saying continue a lot. Um, uh, also like my laptop kept dying. Um uh

[19:38] and then like but like more concretely what you actually do is like a bunch of leading questions like why are we doing this? Uh can we do this? Also I end up saying like can you do this faster or like what's taking so long? Because it kind of like talks itself into making up rules. Um uh and also it tends to not be uh it tends to like underestimate what it can do. Um so I often end up saying things like this to Claude to to get it to like uh try harder.

[20:23] And the result is that uh Jetream 3 which is one of the main benchmarks that JavaScript engines use um uh the bun outperforms both JavaScript cores JIT

## Chapter 16: Lessons for large agent projects

[20:37] and no Node.js in like V8 JIT um in most of them. Uh, and the whole time like it's been using cloud code to like build the bun compile like to build bun compile itself and then using the build of cloud code that was compiled with bun compile.

[21:00] Um, uh, so sort of how I think about this is like like the testability thing is super important when you're working on a large project with Claude. Uh, and to make sure that the tests actually test things. Um, and if you're not actively reme-measuring, then it's going to like get worse because it's just if there's so much stuff going on, it's really easy to lose track. Um uh and like it's easier for large projects like this that haven't shipped yet to uh rewrite than it is to refactor.

[21:41] Um and if you don't act ambitiously then the models will like start having like 0.1% improvements instead of like 10% improvements. So you kind of have to constantly nudge it to like hey you can do really cool things if you try harder.

[22:02] Uh you can try this now if you want uh by running bun upgrade- canary if you have bun installed um and then just bun compile. Thanks everyone.
