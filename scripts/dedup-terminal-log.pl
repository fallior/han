#!/usr/bin/perl
# dedup-terminal-log.pl — Smart deduplication of ~/.han/terminal-log.txt
#
# 52GB/1B lines → readable history. The terminal log is built by appending
# diffs from tmux capture-pane every 200ms. Rich content buried under
# massive duplication from repeated screen captures.
#
# Three-tier classification:
#   NOISE  → always drop (spinner, box-drawing, fragments)
#   CONTENT → keep, dedup only against consecutive predecessor
#   FURNITURE → keep up to 20 global emissions, then suppress
#
# Content = unique per-occurrence: user prompts, Claude prose (>60 chars),
#   diff details, git output, errors, timestamps
# Furniture = identical across occurrences: tool summaries, banners,
#   short repeated lines, screen chrome
#
# Usage: perl dedup-terminal-log.pl [input.txt] > output.txt

use strict;
use warnings;
use utf8;
binmode(STDIN, ':utf8');
binmode(STDOUT, ':utf8');
binmode(STDERR, ':utf8');

my $input_file = $ARGV[0] // '-';
my $fh;
if ($input_file eq '-') {
    $fh = \*STDIN;
} else {
    open($fh, '<:utf8', $input_file) or die "Cannot open $input_file: $!\n";
}

my $lines_read = 0;
my $lines_written = 0;
my $empty_count = 0;
my $prev_norm = '';

my %furniture_count;
my $FURNITURE_CAP = 20;

# Content dedup: even "content" lines that appear >CONTENT_CAP times
# within a window are screen recaptures, not genuinely new information.
# Reset at each timestamp marker so the same line in a new session is fresh.
my %content_count;
my $CONTENT_CAP = 3;  # same content line 3x within a session window = recapture

my $counter_re = qr/[↑↓]\s*[\d,.]+\s*[kKmM]?\s*(?:tokens?)?|\d+[ms]\s*\d+s|\$[\d,.]+/;

sub norm {
    my ($line) = @_;
    my $n = $line;
    $n =~ s/$counter_re/##/g;
    $n =~ s/\s+/ /g;
    $n =~ s/^\s+|\s+$//g;
    return $n;
}

# ── NOISE ──
my @noise_pats = (
    qr/^[\s│─┌┐└┘├┤┬┴┼╔╗╚╝║═▐▛▜▝▘]+$/,
    qr/^\s*[⏵⏴].*bypass permissions/,
    qr/^\s*esc to interrupt\s*$/,
    qr/^\s*shift\+tab to cycle\s*$/,
    qr/^[\s]*M-[bB]M-\^/,
    qr/^\s*[✻✶✷✸✹✺⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*$/,
    qr/^\s*[.…]{1,5}\s*$/,
);

sub is_noise {
    my ($line) = @_;
    for my $p (@noise_pats) { return 1 if $line =~ $p; }
    my $s = $line; $s =~ s/\s+//g;
    return 1 if length($s) > 0 && length($s) <= 3
        && $s !~ /^[❯●⎿\-+>*#\d]+$/;
    return 0;
}

# ── CONTENT: lines that are unique per occurrence ──
sub is_content {
    my ($line) = @_;

    # Timestamps — structural markers
    return 1 if $line =~ /^--- .+ ---$/;

    # User prompts — always unique
    return 1 if $line =~ /^❯/;

    # Claude prose responses — LONG ones are unique per occurrence.
    # Short ones like "● Read 1 file (ctrl+o to expand)" are furniture.
    # Threshold: stripped length > 60 chars after the ● prefix
    if ($line =~ /^●\s+(.+)/) {
        my $text = $1;
        # Tool invocations with parens are furniture
        return 0 if $text =~ /^\s*(Read|Write|Edit|Bash|Grep|Glob|Agent|Update|Search|Explore|Skill|Plan)\s*\(/;
        # "ctrl+o" summaries are furniture
        return 0 if $text =~ /ctrl\+o/;
        # "Done" alone is furniture
        return 0 if $text =~ /^\s*Done\.?\s*$/;
        # Short Claude lines (<60 non-ws chars) = furniture
        my $stripped = $text; $stripped =~ s/\s+//g;
        return 0 if length($stripped) < 60;
        # Long Claude prose = content
        return 1;
    }

    # Status completion verbs with timing — content (timing varies)
    return 1 if $line =~ /[✻✶●✽]\s*(Worked|Cooked|Churned|Brewed|Shimmied|Calculated|Percolated)/i;

    # Action verbs (in-progress) — content
    return 1 if $line =~ /[✻✶⠋⠙⠹✽]\s*(Percolating|Shimmying|Brewing|Choreographing|Simmering|Polishing|Contemplating|Meditating|Marinating|Toiling|Crafting|Working|Cooking|Churning|Calculating)/i;

    # Diff detail lines — these repeat heavily from screen captures.
    # Treat as furniture (capped) rather than content.
    # The diff HEADERS are content (commit hash, git remote), details are not.
    # return 0 — fall through to furniture for numbered diff lines

    # Git output headers (unique per commit)
    return 1 if $line =~ /^\s*commit [0-9a-f]{7,}/;
    return 1 if $line =~ /^\s*To\s+(github\.com|git@)\S+\s+[0-9a-f]/;

    # Error/warning lines
    return 1 if $line =~ /Error|error|ERROR|⚠|Warning|warning|FAIL|fail/;

    # Conversation compacted — marks context boundary
    return 1 if $line =~ /Conversation compacted/;

    # Indented prose that's genuinely long (>80 chars) — Claude's explanations
    # But NOT diff context lines (which start with line numbers or +/-)
    if ($line =~ /^\s{2,}/) {
        # Skip numbered code lines from diffs — they're furniture
        return 0 if $line =~ /^\s+\d+\s*[-+]?\s/;
        # Skip lines that look like code (lots of special chars)
        my $s = $line; $s =~ s/\s+//g;
        my $alpha = ($s =~ tr/a-zA-Z//);
        my $total = length($s);
        # If less than 40% alphabetic, it's probably code not prose
        return 0 if $total > 0 && ($alpha / $total) < 0.4;
        return 1 if length($s) > 80;
    }

    # Everything else: furniture
    return 0;
}

while (my $line = <$fh>) {
    chomp $line;
    $lines_read++;

    if ($lines_read % 10_000_000 == 0) {
        printf STDERR "  %dM read, %d kept (%.1f:1)\n",
            $lines_read / 1_000_000, $lines_written,
            $lines_read / ($lines_written || 1);
    }

    next if is_noise($line);

    if ($line =~ /^\s*$/) {
        $empty_count++;
        if ($empty_count <= 1) { print "\n"; $lines_written++; }
        next;
    }
    $empty_count = 0;

    my $n = norm($line);
    next if $n eq '';
    if ($n eq $prev_norm) { next; }
    $prev_norm = $n;

    if (is_content($line)) {
        # Even content has a cap — the same line 3+ times within a
        # window is a screen recapture, not new content.
        # Reset at timestamps AND every 100K input lines (timestamps are
        # too rare — only 21 across the whole file).
        if ($line =~ /^--- .+ ---$/) {
            %content_count = ();
            print "$line\n";
            $lines_written++;
        } elsif ($lines_read % 100_000 == 0) {
            %content_count = ();
            # still process this line below
            my $cc = $content_count{$n} // 0;
            if ($cc < $CONTENT_CAP) {
                print "$line\n";
                $lines_written++;
                $content_count{$n} = $cc + 1;
            }
        } else {
            my $cc = $content_count{$n} // 0;
            if ($cc < $CONTENT_CAP) {
                print "$line\n";
                $lines_written++;
                $content_count{$n} = $cc + 1;
            }
        }
    } else {
        my $c = $furniture_count{$n} // 0;
        if ($c < $FURNITURE_CAP) {
            print "$line\n";
            $lines_written++;
            $furniture_count{$n} = $c + 1;
        }
    }
}

close($fh) unless $input_file eq '-';

my $ratio = $lines_read > 0 ? sprintf("%.0f", $lines_read / ($lines_written || 1)) : 'N/A';
printf STDERR "\n=== Deduplication Summary ===\n";
printf STDERR "Lines read:       %s\n", commify($lines_read);
printf STDERR "Lines written:    %s\n", commify($lines_written);
printf STDERR "Lines dropped:    %s\n", commify($lines_read - $lines_written);
printf STDERR "Compression:      %s:1\n", $ratio;
printf STDERR "Furniture types:  %s\n", commify(scalar keys %furniture_count);

sub commify {
    my $n = reverse $_[0];
    $n =~ s/(\d{3})(?=\d)/$1,/g;
    return scalar reverse $n;
}
