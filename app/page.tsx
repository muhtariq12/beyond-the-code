import TopNav from "@/components/TopNav";
import Tag from "@/components/Tag";
import FormAnatomy from "@/components/FormAnatomy";
import SystemDiagram from "@/components/SystemDiagram";
import MappingWalkthrough from "@/components/MappingWalkthrough";
import TestingLadder from "@/components/TestingLadder";

const REPO = "https://github.com/muhtariq12/beyond-the-code";
const PROFILE = "https://github.com/muhtariq12";

function Section({
  id,
  n,
  kicker,
  children,
}: {
  id: string;
  n: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t hairline pt-10 pb-14 sm:pt-12 sm:pb-16">
      <p className="label mb-3">
        <span className="text-accent">{n}</span> · {kicker}
      </p>
      {children}
    </section>
  );
}

export default function Page() {
  return (
    <>
      <a
        href="#shift"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-14 focus:z-[60] focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
      >
        Skip to the article
      </a>
      <TopNav />

      <main id="top" className="article mx-auto max-w-5xl px-4 pt-24 sm:px-6 sm:pt-28">
        <header className="pb-12">
          <p className="label">An interactive essay · About 6 minutes</p>
          <h1 className="mt-4 max-w-[17ch] font-display text-[clamp(2.6rem,8vw,5rem)] font-medium leading-[1.02] tracking-[-0.025em] text-balance sm:max-w-[20ch]">
            The Hardest Part of Building Software Isn&apos;t Coding
          </h1>
          <p className="mt-6 max-w-[34rem] text-[1.2rem] leading-snug text-muted sm:text-[1.3rem]">
            AI can turn an idea into a prototype surprisingly quickly. Making it work in the real world is
            a different problem.
          </p>
          <p className="mt-6 text-[0.9rem] text-muted">
            By Muhammad Tariq · AI Engineer and Full-Stack Developer
          </p>
          <p className="mt-4 max-w-[34rem] text-[0.85rem] text-muted">
            Key: <Tag kind="wip" /> marks work I&apos;m still building. <Tag kind="hypothetical" /> marks
            an invented example. Nothing here reports results from a live deployment.
          </p>
        </header>

        <Section id="shift" n="01" kicker="The shift">
          <h2>One person can build a lot more than they could</h2>
          <div className="mt-6">
            <p>
              A single developer with a coding agent can now produce, in an afternoon, things that used to
              take days: screens, an API, a database schema, a first round of tests. I use Claude Code to
              build and debug real applications, and the change is real. I&apos;m not going to pretend
              otherwise.
            </p>
            <p>
              But writing code was never the only thing between an idea and a working product. It was just
              the most visible part. When it gets faster, everything else becomes easier to see.
            </p>
          </div>
        </Section>

        <Section id="demo-trap" n="02" kicker="The demo trap">
          <h2>A prototype can look finished and still be wrong</h2>
          <div className="mt-6">
            <p>
              The screens render. The form submits. A success message appears. What you can&apos;t see from
              the outside is what the prototype is quietly assuming: the data is clean, the identifiers
              are unique, the other system answers the way you expect, the user has the permissions the
              code needs.
            </p>
            <p>
              Code that reads well is easy to mistake for code that has been checked. Fast generation
              makes that mistake cheaper to make, because there is more plausible-looking output to
              review.
            </p>
            <aside className="mt-8 max-w-[38rem] border-l-2 border-accent pl-4">
              <p className="label !text-accent">
                Aside · Sanad <Tag kind="wip" />
              </p>
              <p className="mt-2 text-[0.97rem]">
                The same trap shows up in AI features. I&apos;m building Sanad, a UAE legal AI
                application that uses retrieval-augmented generation over legislation datasets, with
                content in more than one language and embedding-based search. Connecting a language model
                to an app takes little effort, and it will answer fluently either way. Whether the answer
                is any good depends on the unglamorous parts: does retrieval find the right law, in the
                right language, from the right version of the data? A fluent answer built on the wrong
                source is worse than no answer.
              </p>
            </aside>
          </div>
        </Section>

        <Section id="simple-form" n="03" kicker="A simple form, a complicated system">
          <h2>Four fields on a form</h2>
          <div className="mt-6">
            <p>
              I&apos;m working on a real-estate application <Tag kind="wip" /> where tenants onboard, get
              mapped to a property and a unit, and where data from NetSuite ERP has to be integrated with
              an existing PHP and MySQL application. The integration is still being built. I&apos;m using
              it here because it shows the problem clearly, not because it is finished.
            </p>
            <p>
              On screen it is a form. Tap a field to see what it depends on.
            </p>
          </div>
          <div className="mt-8">
            <FormAnatomy />
          </div>
          <div className="mt-8">
            <p>
              Nothing in that form is hard to build. What&apos;s hard is that each field is a question
              about the world (who is this person, which unit is theirs, is that still true) asked of
              systems that were not designed together.
            </p>
          </div>
        </Section>

        <Section id="follow-the-data" n="04" kicker="Follow the data">
          <h2>Failures travel downhill</h2>
          <div className="mt-6">
            <p>
              Here is the same flow as a system. Data moves from the ERP through a sync layer into the
              unit records the application reads. The form looks up a unit, an identity is created, and
              access is decided from both. Select a component, then switch on the failure view to see how
              far one error reaches.
            </p>
          </div>
          <div className="mt-8">
            <SystemDiagram />
          </div>
          <div className="mt-8">
            <p>
              Two things to notice. First, a wrong record in the ERP surfaces as a wrong screen for a
              tenant, far from where the mistake started. Second, the most dangerous failure here is not a
              crash. A crash is loud. A wrong tenant-to-unit mapping works perfectly and shows someone the
              wrong thing.
            </p>
            <p>
              So until I have evidence that the mapping is correct, I treat it as a failure scenario, not
              a solved one. Here is how I&apos;d work through it, using an invented bug.
            </p>
          </div>
          <div className="mt-8">
            <MappingWalkthrough />
          </div>
        </Section>

        <Section id="working" n="05" kicker={"What does “working” actually mean?"}>
          <h2>A green build answers a smaller question than users ask</h2>
          <div className="mt-6">
            <p>
              Building mobile apps with Claude Code taught me to be specific when anyone says
              &ldquo;it works.&rdquo; Code that compiles and tests that pass are real progress. They are
              also not the same as someone completing the journey on an actual phone. There are five
              different claims hiding in that one sentence.
            </p>
          </div>
          <div className="mt-8">
            <TestingLadder />
          </div>
          <div className="mt-8">
            <p>
              Each rung is cheap to claim and costs more to earn. &ldquo;The tests pass&rdquo; is a true
              sentence. &ldquo;It works&rdquo; usually isn&apos;t yet. Say which rung you are standing on.
            </p>
          </div>
        </Section>

        <Section id="judgement" n="06" kicker="Where AI helps, and where you still need to think">
          <h2>Agents speed up the doing. The deciding is still yours.</h2>
          <div className="mt-6">
            <p>
              A coding agent will do what you ask, including the wrong thing, with confidence. That makes
              two skills worth more than before: saying precisely what should be true, and then going to
              check that it is.
            </p>
          </div>
          <div className="mt-8 grid border-y hairline md:grid-cols-2 md:divide-x md:divide-[#d8d1c1]">
            <div className="py-5 md:pr-8">
              <h3 className="label !text-accent">Much faster now</h3>
              <ul className="mt-3 space-y-2 text-[0.97rem]">
                <li>Boilerplate, forms, CRUD and glue code</li>
                <li>Translating between formats and frameworks</li>
                <li>Reading unfamiliar code and explaining an error</li>
                <li>First drafts of tests</li>
                <li>Trying a fix, re-running, trying another</li>
              </ul>
            </div>
            <div className="border-t hairline py-5 md:border-t-0 md:pl-8">
              <h3 className="label !text-fail">Still needs judgement</h3>
              <ul className="mt-3 space-y-2 text-[0.97rem]">
                <li>Deciding what the problem really is</li>
                <li>Defining what &ldquo;correct&rdquo; means for a record</li>
                <li>Knowing which assumptions everything else rests on</li>
                <li>Checking against the real environment, not a convenient one</li>
                <li>Weighing what a mistake costs: privacy, money, trust</li>
              </ul>
            </div>
          </div>
        </Section>

        <Section id="smallest-test" n="07" kicker="Build the smallest thing that proves the hypothesis">
          <h2>Test the assumption that would hurt most</h2>
          <div className="mt-6">
            <p>
              Before building more, find the assumption that would do the most damage if it were false.
              Then design the smallest test that could prove it wrong. Here it is applied to the tenant
              example <Tag kind="hypothetical" />.
            </p>
          </div>
          <ol className="mt-8 grid border-y hairline sm:grid-cols-2 lg:grid-cols-4 [&>li]:border-t [&>li]:border-[#d8d1c1] [&>li:first-child]:border-t-0 sm:[&>li:nth-child(2)]:border-t-0 lg:[&>li]:border-l lg:[&>li]:border-t-0 lg:[&>li:first-child]:border-l-0">
            {[
              ["Riskiest assumption", "A building and a unit code together identify exactly one unit in the ERP."],
              ["Smallest test", "Export the units and count duplicates on that pair. Small enough to finish in one sitting."],
              ["Evidence", "A number: how many units collide, and which ones. Not an opinion."],
              ["Decide", "Zero collisions: carry on. Some: change the key, or add a disambiguation step, before building more on top."],
            ].map(([t, d], i) => (
              <li key={t} className="px-0 py-5 sm:px-5 sm:first:pl-0 sm:[&:nth-child(odd)]:pl-0 lg:px-5 lg:first:pl-0">
                <p className="label !text-accent">{i + 1} · {t}</p>
                <p className="mt-2 text-[0.95rem]">{d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <p>
              The same logic applies to products. I&apos;m developing Tareeeq <Tag kind="wip" />, an
              AI-powered commuting companion that explores contextual assistance, voice interaction and
              specialised AI agents. It&apos;s tempting to start from what the technology can do. The
              riskier assumption isn&apos;t &ldquo;can we build voice?&rdquo; It&apos;s &ldquo;does this make
              a commute better for someone?&rdquo; Sophisticated technology doesn&apos;t improve the
              experience by being there. A thin version that someone can use on an actual trip answers that
              sooner than an elaborate one.
            </p>
          </div>
        </Section>

        <Section id="takeaway" n="08" kicker="The takeaway">
          <p className="max-w-[20ch] font-display text-[clamp(2rem,6vw,3.4rem)] font-medium leading-[1.08] tracking-[-0.02em] !mt-0 text-balance">
            Code got cheap. Knowing it&apos;s right didn&apos;t.
          </p>
          <div className="mt-8">
            <p>
              AI has made building faster. It hasn&apos;t made being right any faster, and a lot of
              activity can look like progress while the real question goes unanswered. The work that
              remains is deciding what is true, and then checking.
            </p>
            <p>
              Move quickly, but name the assumption you&apos;re betting on, test that first, and be honest
              about which rung you&apos;ve reached.
            </p>
          </div>
        </Section>
      </main>

      <footer className="border-t border-ink">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-10 text-[0.88rem] text-muted sm:px-6 md:flex-row md:justify-between">
          <div className="max-w-[34rem]">
            <p className="font-display text-lg text-ink">Beyond the Code</p>
            <p className="mt-2">
              Written and built by Muhammad Tariq. The projects mentioned are works in progress, the
              scenarios marked hypothetical are invented, and no deployment results are claimed. This
              site has no backend, tracking or accounts.
            </p>
          </div>
          <ul className="flex gap-6 md:flex-col md:gap-1 md:text-right">
            <li>
              <a className="underline underline-offset-4 hover:text-ink" href={REPO}>
                Source on GitHub
              </a>
            </li>
            <li>
              <a className="underline underline-offset-4 hover:text-ink" href={PROFILE}>
                GitHub profile
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </>
  );
}
