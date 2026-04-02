# Fix for has_many_inversing removal in newer ActiveRecord
# This config option was removed but load_defaults still tries to set it
ActiveSupport.on_load(:active_record) do
  # no-op: has_many_inversing is no longer a valid config
end

module ActiveRecord
  class Base
    # Provide a no-op setter to avoid NoMethodError
    def self.has_many_inversing=(value)
      # no-op — this config was removed
    end
  end
end
