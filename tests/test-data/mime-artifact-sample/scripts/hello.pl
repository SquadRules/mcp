#!/usr/bin/env perl
// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
use strict;
use warnings;
use utf8;
use File::Basename qw(dirname);
use File::Spec;
# Hello world using conf/app-config.toml (MIME: text/x-perl)
my $root = $ENV{KAIROS_MIME_SAMPLE_ROOT};
if ( !defined $root || $root eq '' ) {
    my $scripts = dirname( File::Spec->rel2abs($0) );
    $root = dirname($scripts);
}
open my $fh, '<:encoding(UTF-8)', "$root/conf/app-config.toml" or die "open app-config.toml: $!\n";
my $msg;
while ( my $line = <$fh> ) {
    if ( $line =~ /^\s*message\s*=\s*"([^"]*)"/ ) {
        $msg = $1;
        last;
    }
}
close $fh;
print( ( $msg // 'missing message' ), "\n" );
exit( defined $msg && $msg ne '' ? 0 : 1 );