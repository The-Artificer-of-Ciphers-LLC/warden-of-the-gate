# Engineer Your Coding Agents Like Any Other System

Source: https://www.youtube.com/watch?v=0LeT996Hz3E

Machine-generated transcript (YouTube captions); recognition errors remain (e.g. "cloud coding agents" for Claude Code, "Py" for a harness name). Video-clock timestamps.

[00:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1s) [music]

[00:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=12s) >> All right. Hi everyone. Uh excited to be

[00:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=15s) here and today I'm going to chat about

[00:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=17s) the evolution of software factoring

[00:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=20s) software engineering and how it's

[00:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=21s) becoming factory engineering. So excited

[00:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=24s) to do this. First, a little bit about

[00:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=25s) me. Uh I've been an engineer for

[00:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=28s) a long time. I was a principal engineer

[00:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=31s) at Google. I used to lead engineering on

[00:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=33s) the Google Docs suite. Uh helped scale

[00:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=35s) that product to hundreds of millions of

[00:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=36s) users. I'm currently the founder and CEO

[00:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=40s) of Warp. Uh Warp builds

[00:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=42s) a platform uh for companies to build

[00:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=45s) their own internal software factories.

[00:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=47s) I'm going to show a little bit of that

[00:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=48s) today. Um Warp is also well known for

[00:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=51s) our open source agentic terminal. Has

[00:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=54s) about 65,000 GitHub stars.

[00:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=57s) Uh it's used by almost a million

[00:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=59s) developers.

[01:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=60s) Our mission has always been helping

[01:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=61s) developers ship better software more

[01:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=63s) quickly and it's it's

[01:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=65s) it's cool to evolve what we're doing as

[01:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=67s) the world changes around us.

[01:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=69s) Um this is where I think we're still

[01:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=72s) mostly at.

[01:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=73s) Uh most developers that I talk to, most

[01:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=76s) platform teams um they they're working

[01:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=79s) with individuals who are running their

[01:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=81s) own

[01:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=82s) coding agents locally. Maybe they're

[01:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=84s) running uh multiple of them at a time.

[01:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=87s) Uh it could be through their terminal.

[01:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=88s) It could be through an agentic

[01:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=90s) development environment. Um just show of

[01:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=93s) hands quickly actually. How many people

[01:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=95s) in here are mostly working in this

[01:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=97s) fashion, local multi-threading?

[01:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=101s) Okay, so still still most people but

[01:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=103s) actually not everyone. Um

[01:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=105s) I think that this is going to change and

[01:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=107s) it's starting to change already. Uh the

[01:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=110s) the reasons are there's a few of them.

[01:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=112s) So one is like if you are doing local

[01:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=115s) interactive prompting as your main way

[01:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=117s) of working with coding agents

[02:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=120s) um you're kind limited by

[02:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=122s) you know, human throughput really. Like

[02:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=123s) you cannot automate if every agent needs

[02:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=127s) to be interactively prompted.

[02:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=129s) There's a second reason too that I hear

[02:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=131s) a lot from platform teams

[02:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=134s) and from you know, engineering leaders.

[02:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=136s) This mechanism of like everyone choosing

[02:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=138s) their own local setup,

[02:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=139s) their own models, their own skills, it

[02:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=142s) makes it very hard to

[02:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=144s) actually make sure that you're using

[02:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=145s) these agents efficiently

[02:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=147s) from like a cost perspective and a

[02:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=149s) productivity perspective.

[02:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=151s) And then finally there's like a

[02:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=153s) you know, big security problem and

[02:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=154s) governance problem when everyone is

[02:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=156s) setting up and running their own local

[02:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=157s) agents.

[02:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=158s) And so the thing that is coming

[02:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=162s) I loosely call a software factory that

[02:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=164s) means different things to different

[02:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=165s) people.

[02:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=167s) I would

[02:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=169s) I'm curious for people in this room like

[02:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=171s) how many folks are

[02:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=173s) currently trying to build or building or

[02:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=174s) using their own internal software

[02:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=176s) factories? Show of hands.

[02:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=179s) Guys, so

[03:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=180s) I would say that's almost more than the

[03:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=181s) interactive agents at this point. That's

[03:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=183s) super cool.

[03:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=185s) So

[03:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=186s) I'm going to define what I think of as a

[03:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=188s) software factory, but I'll start by

[03:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=190s) saying what I think a software factory

[03:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=192s) is not.

[03:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=194s) I think it's not just a loose set of

[03:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=196s) automations.

[03:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=198s) I don't think of a software factory as a

[03:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=200s) collection of AI teammates.

[03:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=203s) I don't think it's a shared set of

[03:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=205s) skills and MCPs and I also don't think

[03:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=207s) software factories are personal agent

[03:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=209s) swarms. I think these are all useful

[03:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=212s) primitives, but

[03:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=213s) they're not the end state that we should

[03:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=216s) be shooting for.

[03:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=218s) And so to me, the way that I define

[03:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=220s) software factory is very specific.

[03:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=224s) And I'll unpack this, but I define it as

[03:46](https://www.youtube.com/watch?v=0LeT996Hz3E&t=226s) a code-defined closed loop system for

[03:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=229s) continuously measuring and improving

[03:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=232s) cloud coding agents. That's a mouthful,

[03:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=234s) but let me unpack it.

[03:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=236s) So

[03:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=237s) if you want to build a software factory

[03:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=239s) and really scale it, I believe the first

[04:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=241s) thing you to do is fully encode it in a

[04:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=245s) declarative language. So you need to

[04:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=247s) say,

[04:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=248s) okay, these are all of

[04:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=250s) the coding agents that I want to run.

[04:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=252s) These are how they're triggered.

[04:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=254s) When work comes into this factory, this

[04:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=256s) is the workflow from issue, you know,

[04:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=258s) from triage to spec, whatever your

[04:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=260s) workflow is,

[04:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=261s) you need to specify what MCPs are

[04:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=263s) available, where your agents run. Really

[04:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=266s) as much as you can in a Terraform style

[04:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=269s) declarative uh you know set of code

[04:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=272s) files that define your factory. I'll

[04:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=274s) talk about why this matters in a bit.

[04:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=277s) The second part of it is a continuous

[04:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=279s) closed loop of improvement.

[04:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=281s) And that closed loop can look something

[04:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=283s) like this. This is the typical one. This

[04:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=285s) is just really the SDLC uh where you

[04:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=288s) have ideas that come in from people. Um

[04:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=291s) uh they could come in from automated

[04:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=293s) signals and then your agents do some

[04:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=295s) amount of work um taking that issue

[04:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=299s) through various stages from triage to

[05:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=301s) implementation, verification, monitoring

[05:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=303s) and so on. The important piece here is

[05:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=306s) really this closed loop concept where

[05:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=309s) the more that your agents run,

[05:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=311s) the more efficient you can make this

[05:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=313s) loop. And I'll talk about how you do

[05:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=315s) that in a second.

[05:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=317s) The third really key aspect if you're

[05:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=319s) building a software factory is that

[05:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=321s) everything needs to be measurable.

[05:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=323s) Um if if you're just going on vibes in

[05:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=326s) terms of how you deploy coding agents,

[05:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=328s) you can't be confident that you're

[05:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=330s) actually um getting the best

[05:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=333s) highest quality outputs the at the best

[05:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=335s) cost. You can't be confident you're

[05:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=336s) maximizing throughput. So you really

[05:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=338s) need a a measurement mindset and

[05:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=340s) measurement capabilities.

[05:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=342s) And so if there's one thing that I'm

[05:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=345s) hoping people walk away

[05:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=347s) from this talk with, it's the idea that

[05:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=350s) the way to work with coding agents and

[05:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=352s) the way to think about them

[05:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=354s) is that there there's a really cool

[05:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=356s) fundamental new engineering problem

[05:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=359s) which is how do you take this magic new

[06:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=362s) primitive that we all have that we've

[06:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=364s) gotten the last year. You have these

[06:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=366s) intelligent agents, and how do you

[06:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=368s) engineer a system around them

[06:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=371s) to use them most effectively?

[06:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=373s) To me, it's not about like

[06:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=375s) growing a garden or following a recipe.

[06:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=378s) We're all engineers. We've spent our

[06:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=381s) careers learning how to solve problems

[06:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=382s) from an engineering mindset.

[06:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=384s) And when you think of coding agents as a

[06:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=386s) new engineering primitive,

[06:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=389s) then you naturally want to you'll you'll

[06:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=391s) naturally start to build a certain way

[06:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=393s) of using them. That's the mindset.

[06:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=397s) So yeah, just to unpack that a bit, so

[06:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=398s) there's

[06:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=400s) continual measurement and continual

[06:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=401s) learning,

[06:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=403s) but there's also a new set of tools.

[06:46](https://www.youtube.com/watch?v=0LeT996Hz3E&t=406s) And so when I was learning how to become

[06:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=408s) a better engineer at Google,

[06:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=411s) um you know, I really had to get good at

[06:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=412s) using things like debuggers and

[06:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=414s) profilers and

[06:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=415s) Chrome DevTools and basically there are

[06:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=418s) all of these tools of the trade for

[07:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=420s) building software by hand that maybe are

[07:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=422s) not as important now, but

[07:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=425s) they really separated the the best

[07:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=427s) engineers from the okay engineers.

[07:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=430s) And in the new world of factory

[07:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=432s) engineering, there's a new set of tools

[07:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=435s) that everyone should be trying to to

[07:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=436s) master. And so those are things like

[07:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=438s) evals. It's can you set up

[07:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=442s) self-improvement loops that work?

[07:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=444s) Can you write benchmarks? Can you AB

[07:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=446s) test your factory?

[07:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=449s) And that's a really important skill set

[07:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=451s) and that

[07:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=452s) mastering that skill set is something

[07:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=454s) that I I think of as like factory

[07:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=456s) engineering.

[07:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=458s) Now, that doesn't mean that that's the

[07:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=460s) only kind of engineering you're going to

[07:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=461s) be doing. You're still going to be doing

[07:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=463s) product engineering, meaning

[07:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=465s) you as an engineer should still feel

[07:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=468s) responsible for,

[07:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=470s) you know, does the product you ship

[07:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=472s) actually solve a real user or customer

[07:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=474s) problem?

[07:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=476s) But the best engineers, and I would say

[07:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=478s) like every engineer really is going to

[08:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=480s) need to learn this new tool set of how

[08:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=482s) do you improve the system, not just

[08:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=484s) build the product.

[08:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=487s) And so what does that like?

[08:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=489s) Uh, if you think from first principles

[08:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=491s) about how do you engineer an agentic

[08:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=493s) system,

[08:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=494s) I think you come up with something like

[08:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=496s) this. Doesn't have to be exactly this,

[08:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=498s) but uh, it's kind of an infrastructure

[08:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=500s) stack that uh, that you're going to want

[08:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=502s) to use to engineer your agents. And so,

[08:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=504s) at the bottom of this is what I call

[08:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=506s) factories as code. I talked about this

[08:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=508s) earlier. It's defining all of your

[08:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=512s) coding agent workflows in a in a code

[08:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=514s) format. And the value of that is that

[08:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=516s) you get the ability to branch off it and

[08:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=518s) test different factory configurations.

[08:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=521s) You can roll back.

[08:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=523s) And then, crucially, it opens up the way

[08:46](https://www.youtube.com/watch?v=0LeT996Hz3E&t=526s) for self-improvement, which is the

[08:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=528s) ability for coding agents themselves to

[08:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=530s) suggest changes

[08:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=531s) to how your factory works to get that

[08:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=534s) continual loop going.

[08:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=536s) Above that is a layer of data and

[08:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=538s) context.

[08:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=539s) This is also crucial. So, if you are

[09:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=541s) running coding agents at scale

[09:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=544s) in an organization,

[09:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=546s) you really must be recording every

[09:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=548s) everything that those agents are

[09:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=549s) producing. So, all of their

[09:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=551s) conversations, all of their artifacts,

[09:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=553s) the videos that they make, the

[09:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=555s) screenshots.

[09:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=556s) Uh, and the reason for doing that is

[09:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=558s) that's the raw material

[09:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=560s) that you will use to improve the way

[09:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=562s) your factory works over time.

[09:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=565s) On top of that is a compute layer. Um,

[09:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=567s) so you need to have sandboxing.

[09:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=569s) Uh, sandboxing increases security. It

[09:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=572s) makes your factory more repeatable. Your

[09:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=574s) sandboxing should be probably

[09:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=575s) multi-platform.

[09:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=577s) On top of that is the inference layer.

[09:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=579s) The way that I would think about

[09:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=581s) inference and models

[09:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=582s) in a factory is they are a degree of

[09:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=585s) freedom to test.

[09:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=587s) And so,

[09:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=588s) your factory, however you build it,

[09:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=590s) should support multiple models.

[09:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=592s) Um, it should also support multiple

[09:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=594s) coding agents because

[09:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=596s) you know, Claude Code might be better

[09:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=598s) for some things. Codex, Py,

[10:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=600s) Warp. These harnesses all have different

[10:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=602s) properties. You might want to write your

[10:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=604s) own coding agent harness that has some

[10:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=606s) of your organizational context baked in.

[10:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=608s) So, So platform should support that.

[10:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=610s) On top of that, you need an

[10:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=611s) orchestration layer. So this is what

[10:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=613s) actually moves work through the factory.

[10:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=616s) In some ways, the least interesting

[10:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=617s) part, but you need that. And then

[10:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=619s) finally, your factory should be all API

[10:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=622s) and MCP first, so that it can be used

[10:24](https://www.youtube.com/watch?v=0LeT996Hz3E&t=624s) not just by

[10:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=626s) uh, you know, people, but can be used by

[10:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=628s) other coding agents.

[10:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=630s) And it can go to where the work is being

[10:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=632s) done. So your factory should integrate

[10:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=633s) into things like Slack,

[10:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=636s) Linear, Jira, GitHub, and so on.

[10:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=640s) I'm going to give a quick demo of what

[10:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=641s) some of these tools look like in the

[10:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=643s) context of Warp factories. But

[10:46](https://www.youtube.com/watch?v=0LeT996Hz3E&t=646s) this stuff I'm going to show I think

[10:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=648s) applies also

[10:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=650s) if you're building your own.

[10:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=652s) So

[10:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=654s) let me start here. So

[10:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=656s) the at the foundation, I mentioned

[10:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=658s) earlier,

[10:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=659s) is factories in code. And so I'm going

[11:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=662s) to show some code. It's not going to be

[11:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=663s) that interesting, but if you're familiar

[11:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=665s) with something like Terraform, you will

[11:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=667s) get what's going on here.

[11:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=669s) You basically want

[11:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=672s) a declarative way of saying this is my

[11:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=674s) factory.

[11:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=675s) My factory uh has certain policies, it

[11:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=678s) accesses certain repos,

[11:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=680s) it has certain triggers, it has a sort

[11:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=683s) of blueprint that defines the workflow

[11:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=685s) of work going through it.

[11:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=686s) And then if you zoom out, all of these

[11:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=689s) other things that are part of the

[11:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=690s) factory also have code definitions.

[11:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=694s) The second thing, moving up a layer is

[11:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=697s) um

[11:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=698s) the idea that

[11:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=700s) uh

[11:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=701s) uh sorry, that everything that you do

[11:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=705s) in the factory

[11:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=707s) um should be

[11:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=709s) tracked across your entire team. And so

[11:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=713s) this think of think of what I'm showing

[11:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=714s) here is this is a sort of Google Docs

[11:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=717s) style live view of what every coding

[11:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=719s) agent on Warp's team across all of our

[12:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=722s) engineers are doing at all times. And so

[12:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=724s) I could click in and I could see, okay,

[12:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=727s) I don't know what Maggie is working on,

[12:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=728s) but I know I could look at it. She's

[12:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=730s) implementing Opus 55 on the high plan.

[12:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=733s) She's doing it from Slack. It has this

[12:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=735s) artifact. I could look in and see the

[12:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=737s) actual conversation here. I could see

[12:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=739s) what it's generated. And so I could see

[12:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=741s) this in real time, which is cool. But

[12:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=743s) the really important thing is that you

[12:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=745s) gather all this information so that it

[12:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=747s) can be used for um improving the

[12:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=750s) factory. And so that brings me to the

[12:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=753s) third, you know, the third thing moving

[12:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=754s) up the stack here is once you have all

[12:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=757s) of this information that's being stored

[12:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=759s) centrally,

[12:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=760s) you get the ability very easily uh

[12:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=762s) without doing any like install stuff on

[12:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=765s) everybody's laptop, anything like that,

[12:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=767s) to to understand

[12:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=770s) how these coding agents are working.

[12:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=772s) And you can think of that in terms of

[12:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=773s) like traditional output metrics, like

[12:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=776s) your DORA metrics, like okay, cycle

[12:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=778s) time. But you can also think of that in

[12:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=779s) terms of like how automated am I? Like

[13:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=781s) how many human interactions per PR?

[13:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=784s) What's your throughput?

[13:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=786s) You get um you should be able to see

[13:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=788s) data very clearly here on like what's

[13:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=791s) your cost? Again, surfacing this if you

[13:14](https://www.youtube.com/watch?v=0LeT996Hz3E&t=794s) if you don't have this data,

[13:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=795s) you you're kind of flying Uh-oh.

[13:19](https://www.youtube.com/watch?v=0LeT996Hz3E&t=799s) Uh you're kind of flying blind. Um so

[13:21](https://www.youtube.com/watch?v=0LeT996Hz3E&t=801s) this is really important. And then

[13:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=803s) there's this uh next layer of data,

[13:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=806s) which is also really important that I

[13:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=807s) mentioned earlier, which is the ability

[13:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=809s) to set up online evals that run across

[13:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=812s) all your coding agent sessions. And so

[13:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=815s) what I mean by this, an eval is just

[13:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=817s) like as these coding agent sessions are

[13:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=819s) running and they're recording their

[13:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=820s) output, you want uh the ability to to go

[13:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=824s) back and have another agent look at them

[13:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=827s) and score them on some dimension that

[13:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=829s) might indicate how well they're doing.

[13:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=832s) And to make that more concrete, so it's

[13:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=834s) like we have an eval,

[13:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=836s) a score here that we use that is looking

[13:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=838s) for redundant tests. This is a good

[13:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=839s) example. And so one common failure mode

[14:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=842s) of coding agents is that sometimes they

[14:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=844s) will write tests that are unnecessary.

[14:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=847s) We want to catch that, and that's what

[14:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=849s) this eval does. We want the ability then

[14:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=851s) to see, okay, when it's writing too many

[14:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=855s) tests, why is it doing that? And is

[14:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=858s) there a mechanism

[14:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=860s) that we could change in the factory for

[14:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=862s) improving that?

[14:23](https://www.youtube.com/watch?v=0LeT996Hz3E&t=863s) And so again, just to kind of recap

[14:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=865s) here,

[14:26](https://www.youtube.com/watch?v=0LeT996Hz3E&t=866s) uh you want

[14:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=867s) a way of recording all the runs.

[14:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=870s) When these runs run, I didn't show this,

[14:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=872s) but

[14:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=872s) all of the runs are you know, you want

[14:35](https://www.youtube.com/watch?v=0LeT996Hz3E&t=875s) the a way of specifying

[14:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=878s) um what is the sort of like actual loop

[14:40](https://www.youtube.com/watch?v=0LeT996Hz3E&t=880s) that they're running through. You want

[14:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=882s) to be able to see where they are in that

[14:43](https://www.youtube.com/watch?v=0LeT996Hz3E&t=883s) loop.

[14:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=884s) As the runs uh work, you want to be able

[14:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=887s) to gather their data. Once you gather

[14:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=889s) their data, you want to be able to set

[14:50](https://www.youtube.com/watch?v=0LeT996Hz3E&t=890s) up these online evals.

[14:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=893s) And then these online evals give you a

[14:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=894s) sense of like, okay, where are their

[14:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=895s) opportunities for improvement.

[14:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=897s) Once you have that in place,

[15:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=900s) you can do something that we call

[15:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=901s) self-improvement, which is rather than

[15:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=903s) having humans look at the outputs of

[15:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=905s) these scores, you have agents look at

[15:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=907s) the output.

[15:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=908s) And so the way to think about

[15:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=910s) self-improvement is like it looks at the

[15:12](https://www.youtube.com/watch?v=0LeT996Hz3E&t=912s) score output. It says, okay, we saw some

[15:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=915s) number of failed runs.

[15:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=918s) Um let's try to look for patterns

[15:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=922s) in those failures and suggest a possible

[15:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=925s) solution.

[15:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=927s) And then the form that that solution

[15:28](https://www.youtube.com/watch?v=0LeT996Hz3E&t=928s) takes

[15:30](https://www.youtube.com/watch?v=0LeT996Hz3E&t=930s) is

[15:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=931s) uh as a PR against your factory

[15:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=934s) definition. And so this is like

[15:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=938s) the awesome thing about having your

[15:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=939s) factory defined as code and being able

[15:41](https://www.youtube.com/watch?v=0LeT996Hz3E&t=941s) to use coding agents

[15:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=942s) is that you can then have the coding

[15:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=944s) agents diagnose problems

[15:46](https://www.youtube.com/watch?v=0LeT996Hz3E&t=946s) with how they're working internally and

[15:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=948s) suggest fixes to them.

[15:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=951s) The final tool that I'm going to point

[15:52](https://www.youtube.com/watch?v=0LeT996Hz3E&t=952s) out that I mentioned earlier

[15:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=954s) is the ability to create and run

[15:56](https://www.youtube.com/watch?v=0LeT996Hz3E&t=956s) benchmarks. This is also essential. So

[16:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=960s) if you're following discourse online,

[16:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=962s) you'll often see things like, okay, this

[16:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=963s) is the best model, this is the new best

[16:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=965s) skill, this is the best harness. The

[16:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=967s) only way to answer those questions for

[16:09](https://www.youtube.com/watch?v=0LeT996Hz3E&t=969s) real is to test on your own data. And so

[16:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=973s) you should have in place some mechanism

[16:15](https://www.youtube.com/watch?v=0LeT996Hz3E&t=975s) where you you basically create a

[16:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=977s) benchmark set

[16:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=978s) out of your real data,

[16:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=980s) um and then uh replay those tasks.

[16:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=985s) Oops, I'm on the wrong one here. And

[16:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=987s) replay those tasks against different

[16:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=989s) configurations

[16:31](https://www.youtube.com/watch?v=0LeT996Hz3E&t=991s) to see

[16:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=992s) how they would have done if you had

[16:34](https://www.youtube.com/watch?v=0LeT996Hz3E&t=994s) varied some model or varied some harness

[16:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=997s) or varied your factory configuration. So

[16:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=999s) just to make this clearer,

[16:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1004s) this is

[16:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1005s) something that looks like what you might

[16:47](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1007s) get

[16:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1008s) uh when uh a new model drops, like in

[16:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1011s) Sweebench or Terminal Bench.

[16:53](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1013s) It's showing the trade-offs of different

[16:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1015s) models here in terms of cost and

[16:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1017s) quality. You want to be in this upper

[16:58](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1018s) left-hand quadrant,

[17:00](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1020s) but it's on your own actual data.

[17:03](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1023s) And you can you can test not just

[17:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1024s) models, but also you want to be able to

[17:05](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1025s) test, hey, if I got rid of these skills,

[17:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1028s) does my factory perform better or worse?

[17:10](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1030s) So these are some of the tools.

[17:13](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1033s) Um and just to return to this big

[17:16](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1036s) concept, like this has worked well for

[17:17](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1037s) us.

[17:18](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1038s) We have managed to

[17:20](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1040s) use these tools to drastically improve

[17:22](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1042s) our throughput and lower our cost.

[17:25](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1045s) We we are just constantly doing this cuz

[17:27](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1047s) this cost really matters to us where

[17:29](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1049s) we're getting a performance baseline,

[17:32](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1052s) we're scoring, we're benchmarking, we're

[17:33](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1053s) testing, and we're doing factory

[17:36](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1056s) engineering.

[17:37](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1057s) And so

[17:38](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1058s) that brings me back to this last point

[17:39](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1059s) that I just want to emphasize again.

[17:42](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1062s) Engineer your agents.

[17:44](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1064s) It's a new engineering primitive. We're

[17:45](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1065s) all engineers. Think about how you can

[17:48](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1068s) get the most out of them and build the

[17:49](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1069s) system for that.

[17:51](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1071s) I think this is very exciting. Um I know

[17:54](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1074s) there's a lot of like

[17:55](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1075s) angst around what it means to be an

[17:57](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1077s) engineer right now.

[17:59](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1079s) I know we're not writing code, but I'm

[18:01](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1081s) still using all the engineering skills

[18:02](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1082s) that I spent my whole career learning.

[18:04](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1084s) And so to me, it's still a really

[18:06](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1086s) exciting time.

[18:07](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1087s) Uh if you're interested in more

[18:08](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1088s) factories, you can check it out here.

[18:11](https://www.youtube.com/watch?v=0LeT996Hz3E&t=1091s) Thank you all for coming to the talk.
