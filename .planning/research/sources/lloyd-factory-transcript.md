# How to Build a Software Factory That Improves Itself — Zach Lloyd, Warp

Machine-generated transcript (YouTube captions via ai.engineer). Recognition errors remain.

[00:01] [music]
[00:12] So, I'm going to be talking today about
[00:14] software factories and uh specifically
[00:18] like an infrastructure approach to
[00:20] software factories. Um, a little bit
[00:23] about me though before we start. So, I'm
[00:25] Zach. Uh, I've been an engineer for
[00:28] really for a long time at this point. I
[00:30] was a principal engineer at Google. I
[00:31] used to lead engineering on the Google
[00:32] Doc Suite. Helped scale that up to
[00:35] hundreds of millions and I think maybe
[00:37] now over a billion people who use it.
[00:39] I'm currently the founder and CEO at
[00:41] Warp. Uh, Warp is a company in the
[00:44] agentic development space. Our current
[00:46] focus is on helping companies build
[00:49] their own internal software factories.
[00:51] So, we have a platform called Warp
[00:53] Factories which we do that with. We're
[00:55] also uh pretty well known for Warp
[00:57] Terminal, which is an Agentic terminal.
[00:59] It's open source, around 65,000 GitHub
[01:02] stars, almost a million active
[01:03] developers. Um, our focus as a company
[01:06] has always been helping developers ship
[01:09] better software more quickly.
[01:12] Just to set some context on where we're
[01:15] at uh in terms of agentic development.
[01:18] So most companies that I speak with uh
[01:22] are at this like phase of what I think
[01:24] of as interactive prompting. And so
[01:26] they've deployed tools like cloud code
[01:28] or codeex to their engineers. Uh
[01:30] engineers are working on their laptops.
[01:32] They are they might have a bunch of
[01:33] these going but generally they're like
[01:35] interactively prompting agents to build
[01:37] features and fix bugs. And where uh most
[01:42] companies I speak with want to get to is
[01:44] something that is more like automated
[01:46] development. So
[01:48] the reason for that is really there's
[01:52] this um you know they want to get to a
[01:54] world where they are deploying this
[01:56] transformational technology which is
[01:58] agents and LLMs to get the most possible
[02:01] business value at the lowest possible
[02:04] cost in a way that is governed and
[02:07] secure and they're running up against
[02:09] the limits of interactive agents which
[02:11] are like you you're bottlenecked by a
[02:14] person running them. Um it's hard to
[02:17] control costs if everyone has their own
[02:18] setup and it's hard to govern. And so
[02:21] just to double click on that I think for
[02:23] this audience like local agents have
[02:25] this security problem where uh if there
[02:29] is a problem or compromise of a local
[02:31] agent then it's basically has the
[02:34] ability to take over whatever the user
[02:36] who signed in on their laptop is. And so
[02:38] that's not a good thing. Um local agents
[02:41] are also hard to govern. And so right
[02:42] now we're in this situation where you
[02:45] know everyone is kind of configuring
[02:46] their own MCPs, their own skills, their
[02:48] own tools. And it's like you can't see
[02:50] what's going on. You can't audit it. And
[02:52] so the solution uh to both these
[02:55] problems is to sandbox your agents and
[02:58] move them to the cloud. And the product
[03:00] category that is emerging to support
[03:03] this uh is what um you know we call a
[03:06] cloud software factory. [snorts] And so
[03:08] this this term is kind of overloaded,
[03:10] but what it means to me is basically
[03:15] every company is going to set up a loop
[03:17] in the cloud where
[03:19] um a combination of humans and agents do
[03:23] work. And so humans are responsible for
[03:26] putting work in, agents will do
[03:29] different parts of the software life
[03:31] cycle. also a triage. They'll work with
[03:33] the human on a spec. They'll do
[03:35] implementation. They will do computer
[03:38] use verification. And as a as a
[03:41] business, what you're going to want to
[03:42] do is set these up internally. Define
[03:46] all the rules for how humans and agents
[03:47] [music]
[03:48] interact and then get to a spot where
[03:50] you can really, really measure and
[03:53] improve over time. Because getting this
[03:55] concept right is going to be the key
[03:58] driver to how your organization ships
[04:00] software.
[04:02] Um at at warp like our our belief is
[04:04] that you should think of this as
[04:06] infrastructure. So not as like a product
[04:08] or an AI teammate but really like an
[04:10] infrastructure stack that you can build
[04:13] on top of and scale. And the key aspects
[04:16] of this are like it should be open, it
[04:19] should be adaptable and you should think
[04:20] of your factories as something that you
[04:22] define in code. And so by open I mean
[04:27] you want a a factory model that can
[04:29] support different uh different models
[04:31] whether it's open weight or frontier.
[04:33] You want one that can support different
[04:35] harnesses and the reason is just like
[04:37] the best models and harnesses are
[04:39] constantly changing. You want adaptable
[04:42] means like the factory should work with
[04:43] your existing infrastructure. And then
[04:46] finally defined in code means like your
[04:49] factory should be a thing uh that has
[04:53] like a strict definition and that
[04:55] definition should include like what are
[04:57] the workflows, what are the skills, what
[04:59] are the MCPs, where do these run and
[05:01] when you define it in code and version
[05:03] control it then you get the ability to
[05:05] like test different versions of your
[05:07] factory. You get the ability for coding
[05:09] agents to update your factory. So these
[05:11] are some key characteristics.
[05:14] Uh I'll say another thing that I'm
[05:16] hearing from from businesses is like AI
[05:19] sovereignty matters. And so the concept
[05:21] here is like as you think about
[05:24] factories, you should think about uh
[05:26] owning all the data that goes in and all
[05:29] the data that comes out as well.
[05:32] You should think about how do you have
[05:33] these agents running on your own
[05:35] infrastructure and own compute. Um this
[05:37] is what most larger enterprises that we
[05:39] work with want.
[05:41] How do you provide your own inference?
[05:44] And then finally, like I said, any
[05:45] model, any harness. And so really
[05:48] preserve optionality and treat um treat
[05:51] these software factories as something
[05:52] that's very key to your business and
[05:55] that you want to, you know, mostly take
[05:57] ownership of the core ingredients of.
[06:01] Um, another really important point here
[06:03] is like as you think about building your
[06:06] software factory, like if you were to
[06:08] look on Twitter on any given day, you
[06:10] would probably see different model like
[06:13] someone would say like PI is the best or
[06:14] someone say Grock or like there's all
[06:16] these different things in the world
[06:18] around like what is best and you might
[06:19] even see benchmarks like Sweetbench or
[06:21] Terminal Bench. But the world that you
[06:23] want to get to um as you automate more
[06:26] development is actually being
[06:29] measurement first on your own data. And
[06:31] so you should whatever factory model you
[06:33] approach have the ability to score
[06:36] meaning like eval how your coding agents
[06:38] are doing. uh feed those scores into
[06:41] agents that can improve your factory and
[06:44] then also create your own benchmarks.
[06:46] Meaning like be able to take all of your
[06:48] real coding agent tasks and try them
[06:51] against different models and measure how
[06:52] it goes.
[06:55] So I'll also talk a little bit about
[06:57] like um how engineering changes in this
[07:01] factory world.
[07:02] [snorts] And so the way that I I conceive of this
[07:05] and talk about it is you will still have
[07:07] engineers who are very much responsible
[07:09] for building useful things for your
[07:12] customers. And so they'll build be
[07:13] building the features, they'll be fixing
[07:15] bugs, they'll be doing product
[07:16] engineering and they'll be doing it like
[07:18] through the factory. So they put work
[07:20] into the factory. But there's a second
[07:22] kind of engineering which I call factory
[07:25] engineering which is uh either uh your
[07:29] platform team or just your general
[07:31] engineers will have to get good at like
[07:34] trying to make the factory better. So
[07:37] improving the skills,
[07:39] setting the context, changing the model
[07:41] mix, all of these things are going to
[07:43] become more important as engineers are
[07:45] like building and improving the system
[07:48] that actually builds the software.
[07:51] So, I'm going to I'm going to show what
[07:53] some of this looks like in practice. And
[07:54] again, this is going to be in the
[07:56] context of our own product, Warp
[07:58] Factories. But these general concepts, I
[08:00] think, will translate to however you're
[08:03] thinking about building your factories.
[08:06] I'll try to leave a little bit of time
[08:07] for questions at the end if I can.
[08:10] So
[08:12] I'm going to start with um the view of
[08:16] the factory that the factory engineer or
[08:19] the manager has. And so this is like
[08:23] if you are
[08:25] someone who is trying to get better uh
[08:28] productivity across your team, you're
[08:30] going to want some view of like what is
[08:34] happening from a productivity standpoint
[08:35] like how automated is my factory? Uh
[08:38] you're going to want a view of um what's
[08:41] it what's the cycle time. So like a
[08:43] dorometric view. You're going to want a
[08:45] view of uh spending. This might take a
[08:47] second to load. Um but basically you
[08:50] want all this data tracked. And the way
[08:53] that you get these views is by having a
[08:57] system where everything that your team
[09:01] is doing, I don't know if you all can
[09:03] see this, but everything that's
[09:05] happening on our team, and this is
[09:07] Warp's internal software development
[09:09] that I'm leaking here, but it's like I
[09:12] can see what I can see what every
[09:14] engineer on our team is doing, and I can
[09:16] see what all the automations that we're
[09:17] running are doing. And not just can I
[09:20] see them like I can see all the
[09:21] artifacts that they're creating, but all
[09:23] this is getting stored. And so all these
[09:26] agent traces, you know, I I could
[09:28] actually go in I could see what this
[09:30] this one is doing. I could go in and
[09:32] like see the actual conversation that
[09:34] someone is doing. But the important
[09:36] thing here is that um all this data is
[09:39] getting stored and what your coding
[09:41] agents are doing is the raw material for
[09:44] improving them. And so, uh, you might be
[09:46] wondering, well, how do how do engineers
[09:49] actually do this work? Like, how are
[09:50] they putting stuff in? Um, and the
[09:52] answer on this is that they put it in
[09:55] through the tools that they're already
[09:56] using. So, on our team, they're using
[09:59] Slack uh to do a lot of the work. Um,
[10:02] they put in uh agentic work through our
[10:04] task tracker, which we use linear, but
[10:06] it could be Jira. They have the same
[10:08] context whether they're uh responding to
[10:11] a GitHub PR comment. And so the the idea
[10:14] here is like the product engineers are
[10:16] using the tools that they're already
[10:17] using, but all the work goes into this
[10:19] centralized location where you get a
[10:21] centralized view and all this stuff gets
[10:23] recorded over time by recording
[10:25] everything. Uh just to go back to this
[10:28] dashboard for a second. Um actually let
[10:32] me let me not do that for one second.
[10:33] The other thing that's important here
[10:34] that I I talked about earlier is like
[10:36] the factory workflow itself defining it
[10:40] as code. And so this is um our kind of
[10:43] like default factory workflow where
[10:46] think of it as like workflows in we have
[10:49] this orchestrator agent that will figure
[10:51] out okay should this next go to a triage
[10:54] step should it go to a spec step an
[10:55] implementation step code review the
[10:58] actual details of this need to be very
[11:00] very flexible. Um if you click into one
[11:03] of these you can see like essentially
[11:06] you are providing an agent definition
[11:09] there's uh which is like what are all
[11:11] the secrets the MCPS the agent prompt
[11:14] the model all this stuff the the cool
[11:17] thing though that I would emphasize that
[11:20] however you're approaching this you
[11:21] probably want to do is that there's an
[11:24] actual code repo that sits behind this
[11:27] where if you go and like look in that
[11:29] repo you can see like I that earlier, a
[11:32] definition of the entire factory at any
[11:35] given point in time. And so that
[11:36] definition includes, think of it as like
[11:39] everything that goes into the process of
[11:41] automating development. Um, it's your
[11:44] it's your uh agent definitions, it's
[11:47] your automations, your benchmarks, it's
[11:49] where these agents run, the skills, the
[11:50] web hooks, everything. So everything
[11:52] gets stored in in a repo that it allows
[11:55] for automation. Um, and I'll I'll I'll
[11:58] show a little more why that matters in a
[12:00] second.
[12:01] The other thing uh just to return to
[12:03] this view for a second because I think
[12:04] it's interesting. You get these metrics
[12:07] around productivity and spend but you
[12:09] also want to set up something where
[12:11] there are like we call them scores. You
[12:14] could think of it as like online evals.
[12:17] And what what you're looking at here is
[12:20] basically we have a set of agents that
[12:23] are looking at all of these runs that
[12:25] are going through our system. So
[12:27] remember I go back here. It's like you
[12:28] can see everything that everyone's doing
[12:30] on our team. You then have a scoring
[12:32] mechanism that goes and looks at those
[12:35] runs and sort of figures out by using
[12:39] LLM as a judge whether or not um those
[12:43] runs are good or not. And so for
[12:46] instance we have a scorer here that is
[12:49] looking for agents that are writing
[12:50] redundant tests which is a common
[12:52] failure mode with these coding agents.
[12:54] And so for the most part, our our agents
[12:56] seem to be doing pretty well here. But
[12:58] if you look back in time, you'll see
[12:59] there's some set of them where an agent
[13:01] is deciding, okay, this was this thing
[13:04] wrote tests that didn't need to be
[13:05] written. And so every one of these
[13:07] failures is an opportunity for improving
[13:11] how your system works. And so as you
[13:14] gather this information, and you know,
[13:17] you could go look at this as a person
[13:18] and grade it, but it's much more
[13:20] efficient to have agents do it. As you
[13:22] gather this information, you can then
[13:24] use it to feed what we call a
[13:26] self-improvement loop. And so the idea
[13:29] behind a self-improvement loop is that
[13:32] uh agents will go and they'll look at
[13:34] all these failure modes. They'll
[13:36] aggregate them. They will look for
[13:38] patterns and then they will come up with
[13:40] ideas for how do you improve the
[13:43] underlying factory definition so that
[13:46] going forward you don't have this same
[13:48] failure mode. And so you know for
[13:52] instance um I don't know I'm going to
[13:53] pick a random one here. Um this is like
[13:58] read matching repository skills before
[14:00] implementing. The key thing here is like
[14:03] it's saying I saw this fail 37 times and
[14:07] then it's saying okay we can actually um
[14:11] oops we can actually fix this
[14:15] um with a PR
[14:18] to the factory definition.
[14:21] So this is like closing the loop where
[14:24] the agent has identified a problem then
[14:26] it's suggesting a change to actually
[14:28] drive a better result in the factory. So
[14:30] this is like a a core concept I think as
[14:33] you think of like how do you really
[14:34] improve development it's it's about
[14:37] creating these loops where agents can
[14:39] identify problems and then fix them.
[14:42] There's one more thing that I want to
[14:43] show and then maybe I'll take a couple
[14:45] questions. Um I mentioned early on like
[14:49] you can't really trust the public
[14:52] benchmarks [clears throat]
[14:53] as like a way of understanding how good
[14:55] a certain model or harness is going to
[14:57] be on your own workflows. And so what
[14:59] you want to get to a point where you can
[15:01] do is basically take any past run. So we
[15:06] can do this like with any anything that
[15:09] we've done in our system. I could go
[15:10] into it here and I have the um
[15:14] sorry I picked a bad example. I um
[15:20] uh maybe I'm picking a bad example. The
[15:22] the idea here is like you can basically
[15:24] take past runs. I don't know why I can't
[15:28] do this here and say okay I want to add
[15:30] this to a benchmark suite and what this
[15:33] is doing is say okay this is like a
[15:35] representative thing that I did in my
[15:36] factory that could be useful to measure
[15:40] by testing it with different model
[15:41] configurations and so think of like
[15:43] building up a a suite of like front-end
[15:45] tasks and the question that you're
[15:47] trying to answer is like what's the best
[15:50] model for me to use for front-end tasks
[15:51] and like you might look on Twitter but
[15:53] you might also just be like let
[15:55] actually test. And so what you can do or
[15:59] should try to set up for your own system
[16:02] and this is built into warp factory. So
[16:04] I'll show it here is basically curate
[16:07] one of these benchmarks and what what it
[16:11] does is it will replay your real past
[16:15] coding agent tasks and then generate for
[16:18] you what looks like a basically a cost
[16:21] versus quality trade-off graph. And so
[16:24] this is something you'll see when um you
[16:26] know the public benchmarks come out, but
[16:28] this is on your own data. And so in in
[16:31] this case, for example, like we could
[16:33] see GLM53 flash uh was 93% correct on
[16:38] these tasks at a cost of $2. GPT56 soul
[16:42] was like 95% correct, but it cost three
[16:45] times as much. And so you can take this
[16:48] information and then build a model
[16:49] routing strategy that you have real
[16:52] confidence is not just a generic one but
[16:56] for your actual code your stack is
[16:59] actually providing value. And so um this
[17:02] is like I think a good example of like
[17:06] closing the loop. And then just to go
[17:08] back I'm going to finish up here in a
[17:10] second.
[17:12] The
[17:15] the sort of like way that we think about
[17:17] this is like at the bottom of your
[17:19] stack, it's defined in code. It's think
[17:22] of a data layer. What's the data going
[17:24] in and out? Where do these agents run?
[17:26] You really want to sandbox that. You
[17:29] want inference that's flexible. You want
[17:32] a self-improvement layer that gives you
[17:34] something like benchmark scoring. You
[17:36] want orchestration so you can have
[17:38] multi-step workflows. And then you want
[17:40] access from all these existing tools.
[17:42] And so that's like the infrastructure
[17:44] that I think is going to it's going to
[17:46] look something like this. Um no matter
[17:49] how you approach this problem uh if
[17:52] you're interested in our approach
[17:53] obviously we're we're we would love to
[17:55] talk to you. But let me pause there.
[17:58] Hopefully this was interesting to folks.
[17:59] And I might have time for one question.
[18:02] I don't know. Or I might have to go.
[18:06] Yes. What what uh what advice do you
[18:08] have for testing and verification of
[18:11] code at the factory?
[18:12] Awesome question. So the you know one
[18:15] thing that could happen if you do this
[18:17] approach is you get like a pile up of
[18:19] PRs right and so you want some way of
[18:21] like getting them through the big things
[18:23] that I advise are spec driven
[18:25] development. So you can actually test um
[18:28] make sure that the changes are adherent
[18:30] to a spec. And the other thing is
[18:32] computer use verification which I didn't
[18:34] show but actually um you know if you can
[18:37] have agents that verify or produce
[18:40] evidence from the user standpoint that
[18:42] the thing works that can go a long way
[18:44] in terms of like lessening the code
[18:46] review burden. So those are the those
[18:47] are the two things that I recommend.
[18:50] Yes.
[18:50] So how do you plan um the budgets when
[18:53] we are starting a project? How do you
[18:57] plan these verification costs?
[18:59] Yeah. So the the way that we do this is
[19:02] like we give people the tools to measure
[19:04] like what's your cost per PR and then
[19:07] what percent of the cost is going
[19:08] towards like scoring or benchmarking or
[19:10] stuff like that. Uh and then you can
[19:12] kind of extrapolate it out like are you
[19:14] willing to spend x amount on a project
[19:16] or whatever. But the the key the key
[19:19] thing um that that I want people to
[19:21] leave if there's one idea is like really
[19:24] set up something that you can measure
[19:25] and improve. And once you can truly
[19:27] measure in a closed loop system, you can
[19:30] you can do all of these things in a way
[19:31] that's just never been possible before.
[19:36] Any other questions?
[19:38] Question in the back.
[19:38] Ycess.
[19:48] Yeah. So, so the question was around uh
[19:51] how do we do cost per PR? So this is
[19:53] data curation
[19:54] the the data curation
[19:57] um are you so I just want to make sure
[19:59] we're talking about the same thing. So
[20:00] you're talking about like when I
[20:03] for the the benchmarking or for like our
[20:06] general
[20:10] Okay. Yeah. So the way that we we do
[20:12] this is like you can either build up a
[20:14] benchmark set by hand which a lot of
[20:16] people will do. They'll you know and
[20:18] that's kind of what we recommend to
[20:19] start. uh we will pick like for ours we
[20:22] pick like a set of sort of small medium
[20:24] hard tasks whatever you want uh to be
[20:27] representative or you can actually ask
[20:30] the factory to do it because the factory
[20:33] is aware of all the past sessions and so
[20:35] and everything is stored in code so it's
[20:37] possible to have the factory itself look
[20:40] at prior sessions and identify
[20:42] interesting ones for a benchmark set
[20:44] which is pretty cool
[20:47] y
[20:47] how is correctness evaluated on chart.
[20:50] Yeah. So everything in this chart is
[20:52] driven by LLM as a judge which we we may
[20:56] I think another way of doing it is human
[20:58] grading which makes total sense. We just
[20:59] haven't added that yet. So I would
[21:01] suggest that as well. But basically
[21:03] anything that is defined uh in the
[21:06] system as a scorer. So you define these
[21:09] scores which basically grade how well
[21:11] something is doing can be used as a
[21:13] benchmark evaluation criteria.
[21:17] Yeah.
[21:18] this work platform is this open source
[21:21] or is this only for enterprise?
[21:23] So it is is not open source. It's it's
[21:27] like very flexible and like like the
[21:30] idea is to make it open so you can bring
[21:31] any existing tools into it. It's not
[21:34] only for enterprise like this is for
[21:36] small teams and you can try it out on
[21:38] your personal project. It is best for
[21:41] teams though I will say because like if
[21:43] you're um if you're an it's just
[21:45] overkill for an individual like you're
[21:47] probably gonna want to use like your
[21:48] cloud code sub or something but once you
[21:50] have a team of like maybe 10 or more
[21:51] engineers having a system like this is
[21:53] very valuable.
