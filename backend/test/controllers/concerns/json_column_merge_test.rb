require "test_helper"

class JsonColumnMergeTest < ActiveSupport::TestCase
  # Skip Rails' generator-default fixtures — they were never updated to
  # match the current schema (e.g. latitude=9.99 overflows the column),
  # so loading them via `fixtures :all` in test_helper would error
  # before our tests run. This is a pure unit test on the concern; no
  # DB rows needed.
  self.fixture_paths = []
  self.fixture_table_names = []

  include JsonColumnMerge

  test "merge_json_column deep-merges nested hashes" do
    existing = { "a" => 1, "nested" => { "x" => 10, "y" => 20 } }
    incoming = { "nested" => { "y" => 99, "z" => 30 } }
    result = merge_json_column(existing, incoming)
    assert_equal 1, result["a"]
    assert_equal 10, result["nested"]["x"]   # preserved
    assert_equal 99, result["nested"]["y"]   # overridden
    assert_equal 30, result["nested"]["z"]   # added
  end

  test "merge_json_column replaces arrays wholesale" do
    existing = { "list" => [1, 2, 3] }
    incoming = { "list" => [9, 8] }
    result = merge_json_column(existing, incoming)
    assert_equal [9, 8], result["list"]
  end

  test "merge_json_column handles nil existing" do
    result = merge_json_column(nil, { "a" => 1 })
    assert_equal({ "a" => 1 }, result)
  end

  test "merge_json_column handles nil incoming" do
    result = merge_json_column({ "a" => 1 }, nil)
    assert_equal({ "a" => 1 }, result)
  end

  test "merge_json_column never returns a reference shared with its inputs" do
    incoming = { "a" => 1 }
    result = merge_json_column(nil, incoming)
    refute_same incoming, result, "nil-existing branch must dup incoming"
    result["mutated"] = true
    refute incoming.key?("mutated"), "mutating result must not affect incoming"

    existing = { "a" => 1 }
    result2 = merge_json_column(existing, nil)
    refute_same existing, result2, "nil-incoming branch must dup existing"
    result2["mutated"] = true
    refute existing.key?("mutated"), "mutating result must not affect existing"
  end

  test "merge_json_column wipes existing list when incoming sends []" do
    existing = { "list" => [1, 2, 3] }
    incoming = { "list" => [] }
    result = merge_json_column(existing, incoming)
    assert_equal [], result["list"]
  end
end
