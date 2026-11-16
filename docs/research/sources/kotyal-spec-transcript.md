# Your Spec Has Bugs. Catch Them Before Your Agent Codes — Rajath Mahendrappa Kotyal, AWS

Machine-generated transcript (YouTube captions via ai.engineer). Recognition errors remain.

[00:00] Hi everyone, my name is Rajat Kotial.
[00:02] I'm part of the automated reasoning
[00:04] group at AWS. And today I'm going to
[00:07] talk about a project I worked on
[00:09] recently called KO specification
[00:11] analyzer. And um we use certain
[00:14] techniques which involves formal methods
[00:16] and automated reasoning to prove
[00:19] specification that goes to your coding
[00:21] agent before it writes code.
[00:30] So let's take a certain bug right
[00:34] this is a specification
[00:37] uh snippet and there are two rules for
[00:40] example and uh the rule two says when an
[00:43] order is submitted and this is for a a
[00:46] general e-commerce website let's say
[00:49] when an order is submitted and the
[00:50] inventory is unavailable we place the
[00:53] order as a back order which makes sense
[00:55] when you read it individually and
[00:57] there's also another rule in the same
[00:59] specification file uh which you hand to
[01:01] the coding agent which says u no order
[01:04] shall be placed as a back order and this
[01:06] is a rule we've set so individually read
[01:10] these two lines make sense right but in
[01:14] when an LLM reads this reads both the
[01:16] rules together both cannot hold true at
[01:19] the same time so we need to make sure
[01:22] the we resolve this ambiguity that the
[01:24] LLM is observing.
[01:28] And uh
[01:31] the scope and the reason we
[01:36] uh put an effort into this project is
[01:38] based on public research and recent
[01:41] research, we've observed there's a 20 to
[01:42] 40% drop with unclear prompts on the
[01:46] accuracy the LLM uh generates on the
[01:49] code accuracy, right? and 60 to 90% of
[01:52] valid code is still wrong after it
[01:54] writes it. And also in that case we
[01:57] observe two times the more more
[01:59] regressions when we uh deploy that code.
[02:05] So where do bugs like these hide? Right?
[02:08] We want to detect these bugs before they
[02:10] reach the codebase. And the way only way
[02:13] to do that it's similar to how we write
[02:15] design docs. Similar to how we draw
[02:18] diagrams and flowcharts to make sure the
[02:20] flow is set before we write any code. We
[02:22] want to verify that without a human or
[02:26] anyone reading these files as the first
[02:29] reviewer
[02:31] in one sentence. Let's say the ambiguity
[02:34] and wording wrong level of detail but
[02:37] across sentences we can observe
[02:39] conflicts and gaps in the specification
[02:42] or rules. Right? sentences need reviews
[02:45] that need search in between them and
[02:48] ambiguity searches.
[02:50] So we have a three-step process to do
[02:53] this where the LLM will first refine it.
[02:56] It'll try to clean up the wording on its
[02:58] own and u if it succeeds then well and
[03:01] good but if it cannot we then formalize
[03:04] the um English language into SMT
[03:08] formulas. So, SMT lib is a certain set
[03:12] of type of function which we pass to a
[03:15] SAT solver a satisfiability checker
[03:17] where it's going to give out a boolean
[03:19] saying this expression that you've given
[03:22] me is valid true or false invalid
[03:27] and then once the solver gets back to us
[03:29] if that expression is valid then we
[03:31] don't do anything. But if it detects any
[03:33] ambiguity between two sentences or
[03:35] within a sentence where there's two
[03:37] meanings to a sentence, then we detect
[03:39] that and tell the LLM to recheck that
[03:43] sentence and it's going to reiterate on
[03:45] that.
[03:47] For example, the rules we saw
[03:51] we've seen when order is submitted and
[03:53] inventory is unavailable, we shall place
[03:55] the order as a back order. And in SMT
[03:59] format, it kind of looks like this. This
[04:01] is like a math formula, right?
[04:08] Once we go deeper, we
[04:11] once we detect this, we also do a
[04:14] three-step process again where we sample
[04:17] the translations again and again. We ask
[04:19] the LLM to translate it seven times or
[04:21] 10 times and to understand whether this
[04:24] LLM is behaving this way uh based on its
[04:29] inherent capabilities or is something
[04:31] affecting it to behave this way and then
[04:34] based on logical equivalence of these
[04:36] seven or 10 um different set of
[04:39] interpretations by the LLM we cluster
[04:41] them on logical equivalence which sets
[04:44] which uh um entries came under which uh
[04:49] assumptions that the LLM made for itself
[04:52] and then we accept or ask the user to
[04:55] clear out the ambiguity or abstain from
[04:58] implementing that in the codebase.
[05:05] This is an example of asking the human
[05:09] um what you want to do with that spec
[05:13] rule that was um perhaps contradicting.
[05:16] remove the record is very a very vague
[05:18] statement. The LLM cannot can interpret
[05:21] anything it wants but we shouldn't allow
[05:23] that to happen and we either give two
[05:26] options we keep it as is the record is
[05:28] deleted or we retain it and but hide it
[05:31] from the users which one does the user
[05:33] prefer.
[05:37] Um
[05:39] a conflict is when the examples we
[05:41] example we saw rule one is conflicting
[05:43] with rule three and a gap is where no
[05:46] rule covers an idle order in this
[05:49] example where the LLM detected an actual
[05:53] sorry
[05:55] process or pipeline detected there's no
[05:58] um entry for this rule where you are
[06:01] missing something
[06:06] all in Well, it cannot do a lot of
[06:08] things. End of the day, we want to make
[06:12] sure there is no oracle uh for for
[06:15] specification correctness other than the
[06:17] user. User needs to make sure to check
[06:20] every part of the snippet part of the
[06:23] rule book before sending it to the LLM.
[06:25] And um we as a tool only can help them
[06:31] and the user is more important here
[06:34] because of implicit domain knowledge.
[06:36] The LLM doesn't know a lot of domain
[06:38] knowledge and there's no guarantee I
[06:40] mean LLM only uh user can give that
[06:44] guarantee right and there's thin
[06:46] evidence right now for formalization and
[06:48] how it can be used in agents we are
[06:50] emerging in this technology
[06:56] what do we take back from this um talk
[07:00] check the spec always before you pass it
[07:02] down to the agent uh cluster the
[07:05] translation We what we do is we cluster
[07:07] the translation by logical equivalent to
[07:11] determine the different LLM
[07:13] interpretations and where it's genuinely
[07:15] going wrong. The LLM translates, the
[07:18] solver checks and the human decides. We
[07:21] give the human uh options and if there's
[07:24] no answer to that, we use LLM judges or
[07:27] abstain from implementing that piece.
[07:32] Here are the references and u this work
[07:35] has been majorly contributed by my team
[07:38] um Andrea Jin Stefan and Delmos. You can
[07:42] check out their blog in the website link
[07:45] provided and um del deeper into this.
[07:49] Thank you.
